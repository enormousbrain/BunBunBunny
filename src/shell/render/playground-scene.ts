import * as THREE from 'three';
import { CAMERA_MODES } from '../../core/camera/modes';
import {
  EMPTY_INTERPOLATION,
  pushSnapshot,
  sampleAtDelay,
  type InterpolationState,
} from '../../core/net/interpolate';
import { decodeSnapshot } from '../../core/net/snapshot';
import type { Quat } from '../../core/net/quat';
import type { Archetype, Shape, Vec3 } from '../../core/recipe/schema';
import type { PlannedBody, WorldPlan } from '../../core/recipe/world-plan';

interface InstanceBinding {
  readonly mesh: THREE.InstancedMesh;
  readonly instanceIndex: number;
}

type PlayerMotion = 'idle' | 'run';

interface PlayerVisualOptions {
  readonly forwardYawOffset?: number;
}

export interface PlaygroundScene {
  readonly pushSnapshot: (buffer: ArrayBuffer) => void;
  readonly setPlayerBodyId: (bodyId: number) => void;
  readonly setPlayerVisual: (
    root: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    options?: PlayerVisualOptions,
  ) => void;
  readonly render: (
    renderer: THREE.WebGLRenderer,
    aspect: number,
    showPlayer: boolean,
    deltaSeconds: number,
  ) => void;
  readonly dispose: () => void;
}

const MATERIAL_COLORS: Readonly<Record<string, number>> = {
  ground: 0x2f8f69,
  crate: 0xc78b4b,
  ball: 0x58c7e7,
  pillar: 0xd7d3e6,
  block: 0xe15f84,
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const DEFAULT_PLAYER_FORWARD_YAW_OFFSET = 0;
const PLAYER_MOVE_EPSILON = 0.002;
const PLAYER_TURN_RESPONSIVENESS = 16;
const PLAYER_ACTION_FADE_SECONDS = 0.12;
const PLAYER_CLIP_ALIASES: Readonly<Record<PlayerMotion, readonly string[]>> = {
  idle: ['idle', 'stand', 'standing'],
  run: ['run', 'running', 'walk', 'walking', 'jog', 'jogging', 'locomotion'],
};

const geometryForShape = (shape: Shape): THREE.BufferGeometry => {
  switch (shape.kind) {
    case 'box':
      return new THREE.BoxGeometry(
        shape.halfExtents.x * 2,
        shape.halfExtents.y * 2,
        shape.halfExtents.z * 2,
      );
    case 'sphere':
      return new THREE.SphereGeometry(shape.radius, 20, 12);
    case 'cylinder':
      return new THREE.CylinderGeometry(shape.radius, shape.radius, shape.halfHeight * 2, 20);
  }
};

const materialFor = (archetype: Archetype): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: MATERIAL_COLORS[archetype.materialTag] ?? 0xf4efe7,
    roughness: 0.78,
    metalness: 0.02,
  });

const bodiesByArchetype = (
  bodies: readonly PlannedBody[],
): ReadonlyMap<string, readonly PlannedBody[]> => {
  const grouped = new Map<string, PlannedBody[]>();
  for (const body of bodies) {
    const existing = grouped.get(body.archetypeId);
    if (existing === undefined) grouped.set(body.archetypeId, [body]);
    else existing.push(body);
  }
  return grouped;
};

const toThreeQuat = (q: Quat): THREE.Quaternion => new THREE.Quaternion(q.x, q.y, q.z, q.w);

const shortestAngleDelta = (from: number, to: number): number => {
  const delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  return delta < -Math.PI ? delta + Math.PI * 2 : delta;
};

const smoothAngle = (from: number, to: number, deltaSeconds: number): number => {
  const alpha = 1 - Math.exp(-PLAYER_TURN_RESPONSIVENESS * deltaSeconds);
  return from + shortestAngleDelta(from, to) * alpha;
};

const clipWithAliases = (
  clips: readonly THREE.AnimationClip[],
  aliases: readonly string[],
): THREE.AnimationClip | undefined => {
  const exact = clips.find((clip) => aliases.includes(clip.name.toLowerCase()));
  if (exact !== undefined) return exact;
  return clips.find((clip) => {
    const name = clip.name.toLowerCase();
    return aliases.some((alias) => name.includes(alias));
  });
};

const actionsForClips = (
  mixer: THREE.AnimationMixer,
  clips: readonly THREE.AnimationClip[],
): Partial<Record<PlayerMotion, THREE.AnimationAction>> => {
  const actions: Partial<Record<PlayerMotion, THREE.AnimationAction>> = {};
  const idle = clipWithAliases(clips, PLAYER_CLIP_ALIASES.idle);
  const run = clipWithAliases(clips, PLAYER_CLIP_ALIASES.run);
  if (idle !== undefined) actions.idle = mixer.clipAction(idle);
  if (run !== undefined) actions.run = mixer.clipAction(run);
  return actions;
};

export const createPlaygroundScene = (plan: WorldPlan): PlaygroundScene => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e8, 0x33455f, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(5, 8, 4);
  scene.add(keyLight);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const cameraMode = CAMERA_MODES[plan.movementPlane === 'side' ? 'side-2d' : 'isometric'];
  const cameraTarget = new THREE.Vector3(0, 1.2, 0);
  const cameraDistance = 18;

  const groupedBodies = bodiesByArchetype(plan.bodies);
  const instanceBindings = new Map<number, InstanceBinding>();
  const meshes: THREE.InstancedMesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  for (const archetype of plan.archetypes) {
    const bodies = groupedBodies.get(archetype.id) ?? [];
    if (bodies.length === 0) continue;
    const geometry = geometryForShape(archetype.shape);
    const material = materialFor(archetype);
    const mesh = new THREE.InstancedMesh(geometry, material, bodies.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);
    meshes.push(mesh);
    geometries.push(geometry);
    materials.push(material);

    bodies.forEach((body, instanceIndex) => {
      instanceBindings.set(body.bodyId, { mesh, instanceIndex });
      position.set(body.position.x, body.position.y, body.position.z);
      rotation.setFromAxisAngle(Y_AXIS, body.yaw);
      matrix.compose(position, rotation, ONE);
      mesh.setMatrixAt(instanceIndex, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  const playerGeometry = new THREE.CapsuleGeometry(
    plan.substrate.player.capsule.radius,
    plan.substrate.player.capsule.halfHeight * 2,
    6,
    16,
  );
  const playerMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff3ad,
    roughness: 0.62,
    metalness: 0,
  });
  const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
  playerMesh.visible = false;
  scene.add(playerMesh);
  geometries.push(playerGeometry);
  materials.push(playerMaterial);

  let interpolation: InterpolationState = EMPTY_INTERPOLATION;
  let playerBodyId: number | undefined;
  let playerVisual: THREE.Object3D | undefined;
  let playerMixer: THREE.AnimationMixer | undefined;
  let playerActions: Partial<Record<PlayerMotion, THREE.AnimationAction>> = {};
  let activePlayerAction: THREE.AnimationAction | undefined;
  let playerForwardYawOffset = DEFAULT_PLAYER_FORWARD_YAW_OFFSET;
  let playerHeadingYaw = playerForwardYawOffset;
  let playerVisualScale = 1;
  let playerVisualMinY = 0;
  let playerVisualCenterX = 0;
  let playerVisualCenterZ = 0;
  let hasPlayerPose = false;
  const playerPosition = new THREE.Vector3();
  const playerMotionDelta = new THREE.Vector3();
  const playerCameraTarget = new THREE.Vector3(0, 1.2, 0);

  const playPlayerMotion = (motion: PlayerMotion): void => {
    const action = playerActions[motion] ?? playerActions.idle;
    if (action === undefined) return;
    if (action === activePlayerAction) return;
    action.reset().setLoop(THREE.LoopRepeat, Infinity);
    activePlayerAction?.fadeOut(PLAYER_ACTION_FADE_SECONDS);
    action.fadeIn(PLAYER_ACTION_FADE_SECONDS).play();
    activePlayerAction = action;
  };

  const writeInstancePose = (binding: InstanceBinding, bodyPosition: Vec3, bodyRotation: Quat): void => {
    position.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
    matrix.compose(position, toThreeQuat(bodyRotation), ONE);
    binding.mesh.setMatrixAt(binding.instanceIndex, matrix);
    binding.mesh.instanceMatrix.needsUpdate = true;
  };

  const updateCamera = (aspect: number, showPlayer: boolean): void => {
    const target = showPlayer ? playerCameraTarget : cameraTarget;
    const halfHeight = cameraMode.orthoHalfHeight;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    const horizontal = Math.cos(cameraMode.elevation) * cameraDistance;
    camera.position.set(
      target.x + Math.sin(cameraMode.azimuth) * horizontal,
      target.y + Math.sin(cameraMode.elevation) * cameraDistance,
      target.z + Math.cos(cameraMode.azimuth) * horizontal,
    );
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };

  const updatePlayerVisual = (
    bodyPosition: Vec3,
    showPlayer: boolean,
    deltaSeconds: number,
  ): void => {
    playerMotionDelta.set(
      hasPlayerPose ? bodyPosition.x - playerPosition.x : 0,
      0,
      hasPlayerPose ? bodyPosition.z - playerPosition.z : 0,
    );
    const isMoving = playerMotionDelta.lengthSq() > PLAYER_MOVE_EPSILON * PLAYER_MOVE_EPSILON;
    if (isMoving) {
      playerHeadingYaw = smoothAngle(
        playerHeadingYaw,
        Math.atan2(playerMotionDelta.x, playerMotionDelta.z) + playerForwardYawOffset,
        deltaSeconds,
      );
    }
    playPlayerMotion(isMoving && showPlayer ? 'run' : 'idle');
    hasPlayerPose = true;
    playerPosition.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
    playerCameraTarget.set(bodyPosition.x, bodyPosition.y + 0.45, bodyPosition.z);
    if (playerVisual === undefined) {
      playerMesh.visible = showPlayer;
      playerMesh.position.copy(playerPosition);
      playerMesh.rotation.y = playerHeadingYaw;
      return;
    }
    playerMesh.visible = false;
    playerVisual.visible = showPlayer;
    if (!showPlayer) return;
    const capsuleHeight = (plan.substrate.player.capsule.halfHeight + plan.substrate.player.capsule.radius) * 2;
    playerVisual.position.set(
      bodyPosition.x - playerVisualCenterX * playerVisualScale,
      bodyPosition.y - capsuleHeight / 2 - playerVisualMinY * playerVisualScale,
      bodyPosition.z - playerVisualCenterZ * playerVisualScale,
    );
    playerVisual.rotation.y = playerHeadingYaw;
  };

  return {
    pushSnapshot: (buffer) => {
      interpolation = pushSnapshot(interpolation, decodeSnapshot(buffer));
    },
    setPlayerBodyId: (bodyId) => {
      playerBodyId = bodyId;
    },
    setPlayerVisual: (root, clips, options = {}) => {
      if (playerVisual !== undefined) scene.remove(playerVisual);
      playerVisual = root;
      playerForwardYawOffset = options.forwardYawOffset ?? DEFAULT_PLAYER_FORWARD_YAW_OFFSET;
      playerHeadingYaw = playerForwardYawOffset;
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const capsuleHeight = (plan.substrate.player.capsule.halfHeight + plan.substrate.player.capsule.radius) * 2;
      playerVisualScale = size.y === 0 ? 1 : capsuleHeight / size.y;
      playerVisualMinY = bounds.min.y;
      playerVisualCenterX = center.x;
      playerVisualCenterZ = center.z;
      root.scale.setScalar(playerVisualScale);
      root.visible = false;
      scene.add(root);
      playerMixer = new THREE.AnimationMixer(root);
      playerActions = actionsForClips(playerMixer, clips);
      activePlayerAction = undefined;
      playPlayerMotion('idle');
    },
    render: (renderer, aspect, showPlayer, deltaSeconds) => {
      playerMixer?.update(deltaSeconds);
      let sawPlayer = false;
      for (const pose of sampleAtDelay(interpolation, 2)) {
        const binding = instanceBindings.get(pose.bodyId);
        if (binding !== undefined) writeInstancePose(binding, pose.position, pose.rotation);
        if (pose.bodyId === playerBodyId) {
          sawPlayer = true;
          updatePlayerVisual(pose.position, showPlayer, deltaSeconds);
        }
      }
      if (!sawPlayer && !hasPlayerPose) {
        playerMesh.visible = false;
        if (playerVisual !== undefined) playerVisual.visible = false;
      } else if (!sawPlayer) {
        playPlayerMotion('idle');
        playerMesh.visible = showPlayer && playerVisual === undefined;
        if (playerVisual !== undefined) playerVisual.visible = showPlayer;
      }
      updateCamera(aspect, showPlayer);
      renderer.render(scene, camera);
    },
    dispose: () => {
      meshes.forEach((mesh) => scene.remove(mesh));
      scene.remove(playerMesh);
      if (playerVisual !== undefined) scene.remove(playerVisual);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
};
