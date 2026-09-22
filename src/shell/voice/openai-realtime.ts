import type { CompanionPromptMessage } from '../../core/companion';

export type RealtimeVoiceStatus = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type CompanionAction = 'perk_up' | 'wave';

export type AudioProcessingConfig = {
  readonly enabled: boolean;
  readonly pitchShiftSemitones: number;
  readonly brightnessBoost: number;
};

type RealtimeCallbacks = {
  readonly onStatusChange: (status: RealtimeVoiceStatus, label: string) => void;
  readonly onTalkingChange: (talking: boolean) => void;
  readonly onCompanionAction: (action: CompanionAction) => void;
};

export type OpenAIRealtimeVoiceConfig = {
  readonly companionName: string;
  readonly model: string;
  readonly voice: string;
  readonly tokenEndpoint: string;
  readonly promptMessages: readonly CompanionPromptMessage[];
  readonly audioProcessing?: AudioProcessingConfig;
  readonly callbacks: RealtimeCallbacks;
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null;

const eventType = (event: JsonRecord): string | undefined =>
  typeof event.type === 'string' ? event.type : undefined;

const promptInstructions = (messages: readonly CompanionPromptMessage[]): string =>
  messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join('\n\n');

const clientSecretFromResponse = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.clientSecret === 'string' ? value.clientSecret : undefined;

const companionActionFromArgs = (args: string): CompanionAction | undefined => {
  try {
    const parsed: unknown = JSON.parse(args);
    if (!isRecord(parsed)) return undefined;
    return parsed.action === 'perk_up' || parsed.action === 'wave' ? parsed.action : undefined;
  } catch {
    return undefined;
  }
};

export class OpenAIRealtimeVoice {
  readonly #config: OpenAIRealtimeVoiceConfig;
  #audioContext: AudioContext | undefined;
  #analyser: AnalyserNode | undefined;
  #peerConnection: RTCPeerConnection | undefined;
  #dataChannel: RTCDataChannel | undefined;
  #remoteSource: MediaStreamAudioSourceNode | undefined;
  #processingNodes: AudioNode[] = [];
  #rubberBandReady = false;
  #audioElement: HTMLAudioElement | undefined;
  #micTrack: MediaStreamTrack | undefined;
  #active = false;

  constructor(config: OpenAIRealtimeVoiceConfig) {
    this.#config = config;
  }

  getAnalyser(): AnalyserNode | undefined {
    return this.#analyser;
  }

  async start(): Promise<void> {
    if (this.#active) return;
    this.#active = true;
    this.#config.callbacks.onStatusChange('connecting', `Connecting ${this.#config.companionName} voice...`);

    try {
      const clientSecret = await this.#clientSecret();
      const AudioContextConstructor = window.AudioContext;
      this.#audioContext = new AudioContextConstructor();
      if (this.#audioContext.state === 'suspended') await this.#audioContext.resume();

      this.#analyser = this.#audioContext.createAnalyser();
      this.#analyser.fftSize = 512;
      this.#analyser.smoothingTimeConstant = 0.4;
      this.#analyser.minDecibels = -90;
      this.#analyser.maxDecibels = -10;
      await this.#prepareAudioProcessing();

      const pc = new RTCPeerConnection();
      this.#peerConnection = pc;
      pc.ontrack = (event) => this.#connectRemoteAudio(event.streams[0]);

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const micTrack = micStream.getAudioTracks()[0];
      if (!micTrack) throw new Error('No microphone track available');
      this.#micTrack = micTrack;
      pc.addTrack(micTrack, micStream);

      const dc = pc.createDataChannel('oai-events');
      this.#dataChannel = dc;
      dc.onopen = () => {
        this.#sendSessionUpdate();
        this.#triggerGreeting();
        this.#config.callbacks.onStatusChange('listening', `${this.#config.companionName} is listening.`);
      };
      dc.onmessage = (event: MessageEvent<string>) => this.#handleServerEvent(event.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      });
      if (!sdpResponse.ok) throw new Error(`Realtime SDP failed: ${sdpResponse.status}`);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() });
    } catch (error) {
      this.#active = false;
      this.#config.callbacks.onStatusChange(
        'error',
        error instanceof Error ? error.message : 'Realtime voice failed.',
      );
      this.stop();
    }
  }

  stop(): void {
    this.#active = false;
    this.#config.callbacks.onTalkingChange(false);
    this.#config.callbacks.onStatusChange('off', 'Voice off.');
    this.#remoteSource?.disconnect();
    this.#remoteSource = undefined;
    this.#processingNodes.forEach((node) => node.disconnect());
    this.#processingNodes = [];
    this.#audioElement?.pause();
    this.#audioElement = undefined;
    this.#dataChannel?.close();
    this.#dataChannel = undefined;
    this.#peerConnection?.getSenders().forEach((sender) => sender.track?.stop());
    this.#peerConnection?.close();
    this.#peerConnection = undefined;
    this.#micTrack?.stop();
    this.#micTrack = undefined;
    this.#analyser = undefined;
    this.#rubberBandReady = false;
  }

  async #clientSecret(): Promise<string> {
    const response = await fetch(this.#config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#config.model,
        voice: this.#config.voice,
      }),
    });
    const data: unknown = await response.json();
    const clientSecret = clientSecretFromResponse(data);
    if (!response.ok || !clientSecret) {
      throw new Error(isRecord(data) && typeof data.error === 'string' ? data.error : 'Token server failed.');
    }
    return clientSecret;
  }

  #connectRemoteAudio(remoteStream: MediaStream | undefined): void {
    if (!remoteStream || !this.#audioContext || !this.#analyser) return;
    this.#audioElement?.pause();
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.autoplay = true;
    audio.volume = 0;
    void audio.play().catch(() => undefined);
    this.#audioElement = audio;

    this.#remoteSource?.disconnect();
    this.#remoteSource = this.#audioContext.createMediaStreamSource(remoteStream);
    const lastNode = this.#processedOutputNode(this.#remoteSource);
    lastNode.connect(this.#analyser);
    lastNode.connect(this.#audioContext.destination);
  }

  async #prepareAudioProcessing(): Promise<void> {
    const processing = this.#config.audioProcessing;
    if (!processing?.enabled || processing.pitchShiftSemitones <= 0 || !this.#audioContext) return;

    try {
      await this.#audioContext.audioWorklet.addModule('/rubberband-processor.js');
      this.#rubberBandReady = true;
    } catch {
      this.#rubberBandReady = false;
      this.#config.callbacks.onStatusChange('listening', 'Voice connected without pitch shift.');
    }
  }

  #processedOutputNode(inputNode: AudioNode): AudioNode {
    const processing = this.#config.audioProcessing;
    if (!processing?.enabled || !this.#audioContext) return inputNode;

    let lastNode = inputNode;
    if (processing.pitchShiftSemitones > 0 && this.#rubberBandReady) {
      const pitchNode = new AudioWorkletNode(this.#audioContext, 'rubberband-processor');
      const pitchRatio = 2 ** (processing.pitchShiftSemitones / 12);
      pitchNode.port.postMessage(JSON.stringify(['pitch', pitchRatio]));
      pitchNode.port.postMessage(JSON.stringify(['quality', true]));
      lastNode.connect(pitchNode);
      lastNode = pitchNode;
      this.#processingNodes.push(pitchNode);
    }

    if (processing.brightnessBoost > 0) {
      const brightness = this.#audioContext.createBiquadFilter();
      brightness.type = 'peaking';
      brightness.frequency.value = 3000;
      brightness.Q.value = 1;
      brightness.gain.value = processing.brightnessBoost * 12;
      lastNode.connect(brightness);
      lastNode = brightness;
      this.#processingNodes.push(brightness);
    }

    if (processing.pitchShiftSemitones >= 2) {
      const highpass = this.#audioContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = Math.min(150 + processing.pitchShiftSemitones * 15, 600);
      highpass.Q.value = 0.7;
      lastNode.connect(highpass);
      lastNode = highpass;
      this.#processingNodes.push(highpass);
    }

    return lastNode;
  }

  #sendSessionUpdate(): void {
    this.#send({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'],
        instructions: [
          promptInstructions(this.#config.promptMessages),
          'Keep responses to one or two short sentences.',
          `You may call companion_reaction when ${this.#config.companionName} should wave or perk up.`,
        ].join('\n\n'),
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            noise_reduction: { type: 'near_field' },
            turn_detection: { type: 'semantic_vad' },
          },
          output: {
            format: { type: 'audio/pcm', rate: 24000 },
          },
        },
        tools: [
          {
            type: 'function',
            name: 'companion_reaction',
            description: `Trigger a simple ${this.#config.companionName} companion reaction in the UI.`,
            parameters: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['perk_up', 'wave'] },
              },
              required: ['action'],
            },
          },
        ],
        tool_choice: 'auto',
      },
    });
  }

  #triggerGreeting(): void {
    this.#send({
      type: 'response.create',
      response: {
        instructions: `Say a tiny playful hello as ${this.#config.companionName}. Mention that you can hear the player.`,
      },
    });
  }

  #handleServerEvent(raw: string): void {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return;
    switch (eventType(parsed)) {
      case 'input_audio_buffer.speech_started':
        this.#config.callbacks.onStatusChange('listening', 'Listening...');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.#config.callbacks.onStatusChange('thinking', 'Thinking...');
        break;
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        this.#config.callbacks.onTalkingChange(true);
        this.#config.callbacks.onStatusChange('speaking', `${this.#config.companionName} is talking...`);
        break;
      case 'response.output_audio.done':
      case 'response.audio.done':
      case 'response.done':
        this.#config.callbacks.onTalkingChange(false);
        this.#config.callbacks.onStatusChange('listening', `${this.#config.companionName} is listening.`);
        break;
      case 'response.function_call_arguments.done':
        this.#handleFunctionCall(parsed);
        break;
      case 'error':
        this.#config.callbacks.onStatusChange('error', 'Realtime voice error.');
        break;
      default:
        break;
    }
  }

  #handleFunctionCall(event: JsonRecord): void {
    const name = typeof event.name === 'string' ? event.name : '';
    const args = typeof event.arguments === 'string' ? event.arguments : '';
    const callId = typeof event.call_id === 'string' ? event.call_id : '';
    if (name !== 'companion_reaction' || !callId) return;

    const action = companionActionFromArgs(args);
    if (action) this.#config.callbacks.onCompanionAction(action);
    this.#send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({ status: action ? 'done' : 'ignored' }),
      },
    });
  }

  #send(event: JsonRecord): void {
    if (this.#dataChannel?.readyState !== 'open') return;
    this.#dataChannel.send(JSON.stringify(event));
  }
}
