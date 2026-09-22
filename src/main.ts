import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { easeInOutCubic } from './core/animation';
import { encodeInput } from './core/net/input';
import { THE_PLAYGROUND } from './core/recipe/the-playground';
import { validate } from './core/recipe/validate';
import { recipeToWorldPlan } from './core/recipe/world-plan';
import {
  composeCompanionPrompt,
  type CompanionContext,
  type CompanionProfile,
} from './core/companion';
import { isSwipeUp } from './core/gesture';
import {
  mouthEnergyFromFrequencyData,
  smoothMouthEnergy,
} from './core/mouth';
import { applyFeltMaterial } from './shell/render/felt-material';
import { createPlaygroundScene } from './shell/render/playground-scene';
import { PERFECT_LINK } from './shell/transport/channel';
import { createLocalChannel } from './shell/transport/local-channel';
import { OpenAIRealtimeVoice, type RealtimeVoiceStatus } from './shell/voice/openai-realtime';

type ClipName = 'happy_idle' | 'idle' | 'leap' | 'wave';
type Placement = 'center' | 'feed' | 'leap';
type MorphTargetBinding = {
  readonly influences: number[];
  readonly index: number;
};
type MoveControl = 'back' | 'forward' | 'left' | 'right';
interface RenderViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const FEED_YAW = Math.PI / 5;
const LEAP_YAW = FEED_YAW + Math.PI / 2;
const TURN_DURATION_SECONDS = 0.32;
const SIZE_DURATION_SECONDS = 0.65;
const SHRINK_DELAY_SECONDS = 0.25;
const FEED_SIZE = 0.34;
const PLAY_SIZE = 0.2;
const FADE_START_PROGRESS = 0.78;
const WAVE_INTERVAL_MS = 60_000;
const REALTIME_MODEL = 'gpt-realtime';
const REALTIME_VOICE = 'shimmer';
const REALTIME_TOKEN_ENDPOINT = 'http://127.0.0.1:8787/realtime/client-secret';
const REALTIME_AUDIO_PROCESSING = {
  enabled: true,
  pitchShiftSemitones: 4,
  brightnessBoost: 0.3,
} as const;
const PREVIEW_SIDE_INSET = 14;
const PREVIEW_TOP_INSET = 76;
const PREVIEW_BOTTOM_INSET = 126;
const MOVE_KEYS: Readonly<Record<string, MoveControl>> = {
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'forward',
  KeyA: 'left',
  KeyD: 'right',
  KeyS: 'back',
  KeyW: 'forward',
};
const ACTIVE_COMPANION = {
  name: 'Bunny Boy',
  modelUrl: new URL('../assets/bunnyboy-rigged.glb', import.meta.url).href,
  mouthMorphName: 'mouth_open',
  playgroundForwardYawOffset: 0,
} as const;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const centerOffset = new THREE.Vector3();
const rootOffset = new THREE.Vector3();
const fringeViewport = new THREE.Vector2(1, 1);
const cards = [...document.querySelectorAll<HTMLElement>('.game-card')];
const feed = document.querySelector<HTMLElement>('.feed');
const loading = document.querySelector<HTMLElement>('.loading');
const companion = document.querySelector<HTMLElement>('.companion');
const companionStage = document.querySelector<HTMLElement>('.companion__stage');
const closeButton = document.querySelector<HTMLButtonElement>('.game-close');
const playControls = document.querySelector<HTMLElement>('.play-controls');
const voiceButton = document.querySelector<HTMLButtonElement>('.voice-panel__button');
const voiceStatus = document.querySelector<HTMLElement>('.voice-panel__status');
const handoffFade = document.querySelector<HTMLElement>('.handoff-fade');
const bottomNav = document.querySelector<HTMLElement>('.bottom-nav');
const initialCard = cards[0];

if (
  !feed ||
  !loading ||
  !companion ||
  !companionStage ||
  !closeButton ||
  !playControls ||
  !voiceButton ||
  !voiceStatus ||
  !handoffFade ||
  !initialCard
) {
  throw new Error('Feed markup is incomplete');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0, 5.2);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
renderer.setClearColor(0x000000, 0);
renderer.domElement.className = 'character-canvas';
renderer.domElement.setAttribute('aria-label', `${ACTIVE_COMPANION.name} character`);

scene.add(new THREE.HemisphereLight(0xfff0df, 0x4b3762, 2.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.5);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

let focusedCard = initialCard;
let playingCard: HTMLElement | undefined;
let mixer: THREE.AnimationMixer | undefined;
let character: THREE.Group | undefined;
let mouthMorphs: readonly MorphTargetBinding[] = [];
let characterCenter = new THREE.Vector3();
let characterBaseScale = 1;
let characterWidth = 1;
let characterHeight = 1;
let leapDuration = 1;
let leapRootDelta = new THREE.Vector3();
let clips: ReadonlyMap<string, THREE.AnimationClip> = new Map();
let activeAction: THREE.AnimationAction | undefined;
let pointerStartY = 0;
let turnStartedAt: number | undefined;
let sizeStartedAt: number | undefined;
let sizeFrom = FEED_SIZE;
let sizeTarget = FEED_SIZE;
let displaySize = FEED_SIZE;
let placement: Placement = 'feed';
let leapStartedAt: number | undefined;
let fadeStarted = false;
let handoffId = 0;
let waveTimer: number | undefined;
let voice: OpenAIRealtimeVoice | undefined;
let analyserData: Uint8Array<ArrayBuffer> | undefined;
let mouthEnergy = 0;
let playgroundPlayerSlot: number | undefined;
let inputSeq = 0;
let jumpQueued = false;
const heldControls = new Set<MoveControl>();

const companionProfile: CompanionProfile = {
  name: ACTIVE_COMPANION.name,
  style: 'playful, bright, and encouraging',
  traits: ['short pep-talks', 'gentle game commentary', 'curious about the current card'],
  boundaries: ['no body comments', 'no location guesses', 'no outside-life guesses'],
  memory: [
    {
      source: 'personalityAdjustment',
      statement: 'Prefer warm encouragement over teasing while the companion model is still being tuned.',
    },
  ],
};

const companionContext = (): CompanionContext => {
  const title = focusedCard.dataset.game ?? 'the focused game';
  const live = focusedCard.querySelector('.pill--live') !== null;
  return {
    signals: [
      { source: 'gameplay', statement: `The focused recipe is ${title}.` },
      { source: 'sessionTelemetry', statement: live ? `${title} is live with players.` : `${title} is cold.` },
    ],
  };
};

const playgroundRecipe = validate(THE_PLAYGROUND);
if (!playgroundRecipe.ok) {
  throw new Error(`The Playground recipe is invalid: ${JSON.stringify(playgroundRecipe.issues)}`);
}
const playgroundPlan = recipeToWorldPlan(playgroundRecipe.recipe);
const playgroundScene = createPlaygroundScene(playgroundPlan);
const playgroundChannel = createLocalChannel(playgroundPlan, PERFECT_LINK);
playgroundChannel.onSnapshot(playgroundScene.pushSnapshot);
void playgroundChannel
  .start()
  .then(() => playgroundChannel.addPlayer())
  .then(({ slot, bodyId }) => {
    playgroundPlayerSlot = slot;
    playgroundScene.setPlayerBodyId(bodyId);
  });

const setVoiceStatus = (status: RealtimeVoiceStatus, label: string): void => {
  voiceStatus.textContent = label;
  voiceButton.classList.toggle('is-live', status !== 'off' && status !== 'error');
  voiceButton.textContent = status === 'off' || status === 'error' ? 'Talk' : 'Stop';
};

const voiceAnalyser = (): AnalyserNode | undefined => voice?.getAnalyser();

const mouthInfluence = (): number => {
  const analyser = voiceAnalyser();
  if (!analyser) {
    mouthEnergy = smoothMouthEnergy(mouthEnergy, 0);
    return mouthEnergy;
  }
  if (!analyserData || analyserData.length !== analyser.frequencyBinCount) {
    analyserData = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(analyserData);
  mouthEnergy = smoothMouthEnergy(mouthEnergy, mouthEnergyFromFrequencyData(analyserData));
  return mouthEnergy;
};

const morphTargetsNamed = (root: THREE.Object3D, name: string): readonly MorphTargetBinding[] => {
  const targets: MorphTargetBinding[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const index = object.morphTargetDictionary?.[name];
    if (object.morphTargetInfluences && index !== undefined) {
      targets.push({ influences: object.morphTargetInfluences, index });
    }
  });
  return targets;
};

const resize = (): void => {
  const { clientWidth, clientHeight } = renderer.domElement;
  if (clientWidth === 0 || clientHeight === 0) return;
  renderer.setSize(clientWidth, clientHeight, false);
  fringeViewport.set(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
};

const viewportFromEdges = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): RenderViewport | undefined => {
  const { clientWidth, clientHeight } = renderer.domElement;
  const x1 = Math.max(0, Math.min(clientWidth, left));
  const y1 = Math.max(0, Math.min(clientHeight, top));
  const x2 = Math.max(0, Math.min(clientWidth, right));
  const y2 = Math.max(0, Math.min(clientHeight, bottom));
  const width = x2 - x1;
  const height = y2 - y1;
  return width < 1 || height < 1
    ? undefined
    : { x: x1, y: clientHeight - y2, width, height };
};

const playgroundViewport = (): RenderViewport | undefined => {
  const { clientWidth, clientHeight } = renderer.domElement;
  if (clientWidth === 0 || clientHeight === 0) return undefined;
  if (playingCard) return { x: 0, y: 0, width: clientWidth, height: clientHeight };
  const rect = focusedCard.getBoundingClientRect();
  // ponytail: inset preview avoids the shared overlay canvas covering card chrome.
  // Use a masked/card-local compositor if previews need edge-to-edge rounded corners.
  return viewportFromEdges(
    rect.left + PREVIEW_SIDE_INSET,
    rect.top + PREVIEW_TOP_INSET,
    rect.right - PREVIEW_SIDE_INSET,
    rect.bottom - PREVIEW_BOTTOM_INSET,
  );
};

const moveVector = (): { readonly x: number; readonly z: number } => ({
  x: (heldControls.has('right') ? 1 : 0) - (heldControls.has('left') ? 1 : 0),
  z: (heldControls.has('back') ? 1 : 0) - (heldControls.has('forward') ? 1 : 0),
});

const sendPlaygroundInput = (): void => {
  if (!playingCard || playgroundPlayerSlot === undefined) return;
  playgroundChannel.sendInput(
    encodeInput({
      playerSlot: playgroundPlayerSlot,
      seq: inputSeq,
      move: moveVector(),
      jump: jumpQueued,
    }),
  );
  inputSeq = (inputSeq + 1) >>> 0;
  jumpQueued = false;
};

const setControlHeld = (control: MoveControl, held: boolean): void => {
  if (held) heldControls.add(control);
  else heldControls.delete(control);
};

const sizeTo = (target: number, delaySeconds = 0): void => {
  sizeStartedAt = timer.getElapsed() + delaySeconds;
  sizeFrom = displaySize;
  sizeTarget = target;
};

const layoutCharacter = (): void => {
  if (!character) return;
  const verticalSpan = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const horizontalSpan = verticalSpan * camera.aspect;
  const scale = characterBaseScale * displaySize;
  const feedCenterX = -horizontalSpan / 2 + (characterWidth * displaySize) / 2 + horizontalSpan * 0.01;
  // Lift the resting companion clear of the bottom nav (canvas is full-viewport).
  const worldPerPixel = verticalSpan / Math.max(1, renderer.domElement.clientHeight);
  const navInset = (bottomNav?.offsetHeight ?? 0) * worldPerPixel;
  const feedCenterY =
    -verticalSpan / 2 + (characterHeight * displaySize) / 2 + verticalSpan * 0.025 + navInset;
  const leapProgress = leapStartedAt === undefined
    ? 0
    : Math.min(1, (timer.getElapsed() - leapStartedAt) / leapDuration);
  rootOffset
    .copy(leapRootDelta)
    .applyAxisAngle(Y_AXIS, LEAP_YAW)
    .multiplyScalar(characterBaseScale * PLAY_SIZE);
  const centerX = placement === 'center'
    ? 0
    : placement === 'leap'
      ? THREE.MathUtils.lerp(feedCenterX, -rootOffset.x, easeInOutCubic(leapProgress))
      : feedCenterX;
  const centerY = placement === 'center'
    ? 0
    : placement === 'leap'
      ? THREE.MathUtils.lerp(feedCenterY, -rootOffset.y, easeInOutCubic(leapProgress))
      : feedCenterY;
  centerOffset.copy(characterCenter).applyAxisAngle(Y_AXIS, character.rotation.y).multiplyScalar(scale);
  character.scale.setScalar(scale);
  character.position.set(centerX - centerOffset.x, centerY - centerOffset.y, -centerOffset.z);
};

const beginLandingFade = (): void => {
  if (fadeStarted) return;
  fadeStarted = true;
  const currentHandoff = ++handoffId;
  handoffFade.classList.add('is-covering');
  handoffFade.addEventListener(
    'transitionend',
    () => {
      if (currentHandoff !== handoffId || !playingCard) return;
      placement = 'center';
      leapStartedAt = undefined;
      if (character) character.rotation.y = FEED_YAW;
      play('idle');
      window.setTimeout(() => {
        if (currentHandoff === handoffId) handoffFade.classList.remove('is-covering');
      }, 80);
    },
    { once: true },
  );
};

const play = (name: ClipName, loop = true): void => {
  const clip = clips.get(name);
  if (!mixer || !clip) return;
  const next = mixer.clipAction(clip);
  next.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  activeAction?.fadeOut(0.12);
  next.fadeIn(0.12).play();
  activeAction = next;
};

const stopWaveTimer = (): void => {
  if (waveTimer === undefined) return;
  window.clearTimeout(waveTimer);
  waveTimer = undefined;
};

const scheduleWave = (): void => {
  stopWaveTimer();
  waveTimer = window.setTimeout(() => {
    waveTimer = undefined;
    if (!playingCard && placement === 'feed') play('wave', false);
    scheduleWave();
  }, WAVE_INTERVAL_MS);
};

const focus = (card: HTMLElement): void => {
  if (playingCard || card === focusedCard) return;
  focusedCard.classList.remove('is-focused');
  focusedCard = card;
  focusedCard.classList.add('is-focused');
  play(card.dataset.reaction === 'excited' ? 'happy_idle' : 'idle', false);
};

const cardNearestCenter = (): HTMLElement =>
  cards.reduce((nearest, card) => {
    const viewportCenter = window.innerHeight / 2;
    const cardCenter = card.getBoundingClientRect().top + card.clientHeight / 2;
    const nearestCenter = nearest.getBoundingClientRect().top + nearest.clientHeight / 2;
    return Math.abs(cardCenter - viewportCenter) < Math.abs(nearestCenter - viewportCenter)
      ? card
      : nearest;
  }, focusedCard);

const startLeap = (): void => {
  const card = playingCard;
  if (!card) return;
  turnStartedAt = undefined;
  placement = 'leap';
  leapStartedAt = timer.getElapsed();
  fadeStarted = false;
  play('leap', false);
  card.classList.add('is-playing');
  companion.classList.add('is-playing');
  feed.classList.add('has-active-game');
  closeButton.hidden = false;
  sizeTo(PLAY_SIZE, SHRINK_DELAY_SECONDS);
  resize();
};

const enter = (card: HTMLElement): void => {
  if (playingCard || card !== focusedCard || !character) return;
  stopWaveTimer();
  play('idle');
  playingCard = card;
  turnStartedAt = timer.getElapsed();
};

const exit = (returnToSelected = false): void => {
  const card = playingCard;
  if (!card) return;
  const commit = (): void => {
    card.classList.remove('is-playing');
    companion.classList.remove('is-playing');
    feed.classList.remove('has-active-game');
    closeButton.hidden = true;
    playingCard = undefined;
    if (returnToSelected) {
      card.scrollIntoView({ block: 'center' });
      focus(card);
    } else {
      focus(cardNearestCenter());
    }
    resize();
  };
  commit();
  handoffId += 1;
  handoffFade.classList.remove('is-covering');
  turnStartedAt = undefined;
  leapStartedAt = undefined;
  fadeStarted = false;
  placement = 'feed';
  sizeTo(FEED_SIZE);
  heldControls.clear();
  jumpQueued = false;
  playControls.hidden = true;
  if (character) character.rotation.y = FEED_YAW;
  play('idle');
  scheduleWave();
};

const observer = new IntersectionObserver(
  (entries) => {
    const centered = entries.find((entry) => entry.isIntersecting);
    if (centered?.target instanceof HTMLElement) focus(centered.target);
  },
  { root: feed, threshold: 0.72 },
);

cards.forEach((card) => {
  observer.observe(card);
  card.addEventListener('click', () => enter(card));
});
closeButton.addEventListener('click', () => exit(true));
playControls.addEventListener('pointerup', (event) => {
  event.stopPropagation();
});
playControls.addEventListener('pointercancel', (event) => {
  event.stopPropagation();
});
playControls.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => {
  const control = button.dataset.control;
  if (control !== 'back' && control !== 'forward' && control !== 'left' && control !== 'right') return;
  const release = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    setControlHeld(control, false);
    button.classList.remove('is-held');
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.setPointerCapture(event.pointerId);
    setControlHeld(control, true);
    button.classList.add('is-held');
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => {
    setControlHeld(control, false);
    button.classList.remove('is-held');
  });
});
playControls.querySelector<HTMLButtonElement>('[data-jump]')?.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  event.stopPropagation();
  jumpQueued = true;
});
voiceButton.addEventListener('click', () => {
  if (voice) {
    voice.stop();
    voice = undefined;
    analyserData = undefined;
    return;
  }
  const nextVoice = new OpenAIRealtimeVoice({
    companionName: ACTIVE_COMPANION.name,
    model: REALTIME_MODEL,
    voice: REALTIME_VOICE,
    tokenEndpoint: REALTIME_TOKEN_ENDPOINT,
    promptMessages: composeCompanionPrompt(companionProfile, companionContext()),
    audioProcessing: REALTIME_AUDIO_PROCESSING,
    callbacks: {
      onStatusChange: setVoiceStatus,
      onTalkingChange: () => undefined,
      onCompanionAction: (action) => {
        if (action === 'wave') play('wave', false);
        if (action === 'perk_up') play('happy_idle', false);
      },
    },
  });
  voice = nextVoice;
  void nextVoice.start();
});

window.addEventListener('pointerdown', (event) => {
  pointerStartY = event.clientY;
});
window.addEventListener('pointerup', (event) => {
  if (playingCard && isSwipeUp(pointerStartY, event.clientY)) exit();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    exit(true);
    return;
  }
  if (!playingCard) return;
  const control = MOVE_KEYS[event.code];
  if (control !== undefined) {
    event.preventDefault();
    setControlHeld(control, true);
  }
  if (event.code === 'Space' && !event.repeat) {
    event.preventDefault();
    jumpQueued = true;
  }
});
window.addEventListener('keyup', (event) => {
  const control = MOVE_KEYS[event.code];
  if (control !== undefined) {
    event.preventDefault();
    setControlHeld(control, false);
  }
});
window.addEventListener('resize', resize);
window.addEventListener('pagehide', () => {
  playgroundChannel.close();
  playgroundScene.dispose();
});
feed.addEventListener('scrollend', () => focus(cardNearestCenter()));

focusedCard.classList.add('is-focused');
companionStage.append(renderer.domElement);

const timer = new THREE.Timer();
timer.connect(document);
const render = (): void => {
  timer.update();
  const delta = timer.getDelta();
  const elapsed = timer.getElapsed();
  mixer?.update(delta);
  if (mouthMorphs.length > 0) {
    const influence = mouthInfluence();
    mouthMorphs.forEach((morph) => {
      morph.influences[morph.index] = influence;
    });
  }
  if (sizeStartedAt !== undefined) {
    const progress = (elapsed - sizeStartedAt) / SIZE_DURATION_SECONDS;
    displaySize = THREE.MathUtils.lerp(sizeFrom, sizeTarget, easeInOutCubic(progress));
    if (progress >= 1) sizeStartedAt = undefined;
  }
  if (character && turnStartedAt !== undefined) {
    const progress = (elapsed - turnStartedAt) / TURN_DURATION_SECONDS;
    character.rotation.y = THREE.MathUtils.lerp(FEED_YAW, LEAP_YAW, easeInOutCubic(progress));
    if (progress >= 1) startLeap();
  }
  if (
    placement === 'leap' &&
    leapStartedAt !== undefined &&
    (elapsed - leapStartedAt) / leapDuration >= FADE_START_PROGRESS
  ) {
    beginLandingFade();
  }
  const showPlaygroundPlayer = placement === 'center';
  playControls.hidden = !showPlaygroundPlayer;
  if (showPlaygroundPlayer) sendPlaygroundInput();
  resize();
  const { clientWidth, clientHeight } = renderer.domElement;
  if (clientWidth === 0 || clientHeight === 0) return;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, clientWidth, clientHeight);
  renderer.clear();

  const gameViewport = playgroundViewport();
  if (gameViewport !== undefined) {
    renderer.setScissorTest(true);
    renderer.setViewport(gameViewport.x, gameViewport.y, gameViewport.width, gameViewport.height);
    renderer.setScissor(gameViewport.x, gameViewport.y, gameViewport.width, gameViewport.height);
    playgroundScene.render(renderer, gameViewport.width / gameViewport.height, showPlaygroundPlayer, delta);
    renderer.setScissorTest(false);
    renderer.clearDepth();
    renderer.setViewport(0, 0, clientWidth, clientHeight);
  }

  if (!showPlaygroundPlayer) {
    layoutCharacter();
    renderer.render(scene, camera);
  }
};
renderer.setAnimationLoop(render);

new GLTFLoader().load(
  ACTIVE_COMPANION.modelUrl,
  (gltf) => {
    applyFeltMaterial(gltf.scene, fringeViewport);
    playgroundScene.setPlayerVisual(cloneSkeleton(gltf.scene), gltf.animations, {
      forwardYawOffset: ACTIVE_COMPANION.playgroundForwardYawOffset,
    });
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    characterCenter = bounds.getCenter(new THREE.Vector3());
    characterBaseScale = 2.6 / size.y;
    characterWidth = Math.max(size.x, size.z) * characterBaseScale;
    characterHeight = size.y * characterBaseScale;
    gltf.scene.rotation.y = FEED_YAW;
    character = gltf.scene;
    mouthMorphs = morphTargetsNamed(gltf.scene, ACTIVE_COMPANION.mouthMorphName);
    if (mouthMorphs.length > 0) {
      mouthMorphs.forEach((morph) => {
        morph.influences[morph.index] = 0;
      });
    } else {
      console.warn(`${ACTIVE_COMPANION.mouthMorphName} was not found in the character mesh.`);
    }
    scene.add(gltf.scene);
    mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.addEventListener('finished', () => {
      if (placement !== 'leap') play('idle');
    });
    clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
    const leapClip = clips.get('leap');
    const rootTrack = leapClip?.tracks.find((track) => track.name.endsWith('.position'));
    if (leapClip && rootTrack && rootTrack.values.length >= 6) {
      const values = rootTrack.values;
      leapDuration = leapClip.duration;
      leapRootDelta = new THREE.Vector3(
        (values.at(-3) ?? 0) - (values.at(0) ?? 0),
        (values.at(-2) ?? 0) - (values.at(1) ?? 0),
        (values.at(-1) ?? 0) - (values.at(2) ?? 0),
      );
    }
    play('wave', false);
    scheduleWave();
    loading.hidden = true;
    resize();
  },
  undefined,
  (error) => {
    loading.textContent = `${ACTIVE_COMPANION.name} could not be loaded.`;
    console.error(error);
  },
);
