import * as THREE from 'three';
import type { Multiplayer } from './Multiplayer';

/**
 * Proximity voice: a WebRTC audio link to every other player in the room
 * (a small mesh, 16 players at most), set up through our own room server.
 * Each voice plays from where that player is standing, so it gets quieter
 * as they walk away and is gone past ~45 m.
 *
 * Every link is opened send+receive from the start; turning your mic on or
 * off just swaps the outgoing track, so nothing has to be renegotiated.
 * Direct connections only (public STUN, no TURN relay): a few strict
 * networks won't connect.
 */
const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

interface Link {
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null;
  panner: PannerNode | null;
  gain: GainNode | null;
  meter: AnalyserNode | null;
  el: HTMLAudioElement | null;
  bad: number;
}

export class VoiceChat {
  mic: MediaStream | null = null;
  private links = new Map<string, Link>();
  private syncT = 0;
  private buf = new Float32Array(256);

  constructor(private mp: Multiplayer, private audio: () => { ctx: AudioContext; out: AudioNode } | null) {
    mp.onSignal = (from, d) => this.onSignal(from, d);
  }

  get micOn() {
    return !!this.mic;
  }

  /** Mic on (asks the browser the first time). Returns false if refused. */
  async micStart(): Promise<boolean> {
    if (this.mic) return true;
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return false;
    }
    const track = this.mic.getAudioTracks()[0];
    for (const l of this.links.values()) l.sender?.replaceTrack(track).catch(() => {});
    return true;
  }

  micStop() {
    for (const l of this.links.values()) l.sender?.replaceTrack(null).catch(() => {});
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
  }

  /** Every frame: keep links to everyone, put each voice where its player stands. */
  update(dt: number, where: (id: string) => THREE.Vector3 | null, muted: Set<string>, talking: (id: string, on: boolean) => void) {
    const ready = this.mp.transport === 'rooms' && this.mp.status === 'connected' && !!this.audio();
    this.syncT -= dt;
    if (this.syncT <= 0) {
      this.syncT = 2;
      for (const id of [...this.links.keys()]) {
        const l = this.links.get(id)!;
        const st = l.pc.connectionState;
        l.bad = st === 'failed' || st === 'disconnected' ? l.bad + 2 : 0;
        if (!ready || !this.mp.peers.has(id) || l.bad > 10) this.drop(id);
      }
      // the lower id calls; the other waits for the offer
      if (ready) for (const id of this.mp.peers.keys()) if (!this.links.has(id) && this.mp.id < id) this.call(id);
    }
    const a = this.audio();
    for (const [id, l] of this.links) {
      if (!l.panner || !l.gain || !a) continue;
      const p = where(id);
      const t = a.ctx.currentTime;
      if (p) {
        l.panner.positionX.setTargetAtTime(p.x, t, 0.05);
        l.panner.positionY.setTargetAtTime(p.y + 1.6, t, 0.05);
        l.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
      }
      l.gain.gain.setTargetAtTime(p && !muted.has(id) ? 1.4 : 0, t, 0.1);
      if (l.meter) {
        l.meter.getFloatTimeDomainData(this.buf);
        let s = 0;
        for (const v of this.buf) s += v * v;
        talking(id, Math.sqrt(s / this.buf.length) > 0.02 && !muted.has(id));
      }
    }
  }

  /** Leaving the room: hang up on everyone. */
  closeAll() {
    for (const id of [...this.links.keys()]) this.drop(id);
  }

  private link(id: string): Link {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const l: Link = { pc, sender: null, panner: null, gain: null, meter: null, el: null, bad: 0 };
    pc.ontrack = (e) => this.hear(l, e.streams[0] ?? new MediaStream([e.track]));
    this.links.set(id, l);
    return l;
  }

  private async call(id: string) {
    const l = this.link(id);
    const tr = l.pc.addTransceiver('audio', { direction: 'sendrecv' });
    l.sender = tr.sender;
    if (this.mic) await tr.sender.replaceTrack(this.mic.getAudioTracks()[0]).catch(() => {});
    await l.pc.setLocalDescription(await l.pc.createOffer());
    await gathered(l.pc);
    if (this.links.get(id) !== l) return;
    this.mp.signal(id, { sdp: { type: 'offer', sdp: l.pc.localDescription!.sdp } });
  }

  private async onSignal(from: string, d: Record<string, unknown>) {
    const sdp = d.sdp as { type?: unknown; sdp?: unknown } | undefined;
    if (d.bye) return this.drop(from);
    if (!sdp || typeof sdp.sdp !== 'string' || sdp.sdp.length > 11000 || (sdp.type !== 'offer' && sdp.type !== 'answer')) return;
    if (this.mp.transport !== 'rooms' || !this.audio()) return;
    try {
      if (sdp.type === 'offer') {
        // they called us: start fresh (a stale link from before is replaced)
        this.drop(from);
        const l = this.link(from);
        await l.pc.setRemoteDescription({ type: 'offer', sdp: sdp.sdp });
        const tr = l.pc.getTransceivers()[0];
        if (tr) {
          tr.direction = 'sendrecv';
          l.sender = tr.sender;
          if (this.mic) await tr.sender.replaceTrack(this.mic.getAudioTracks()[0]).catch(() => {});
        }
        await l.pc.setLocalDescription(await l.pc.createAnswer());
        await gathered(l.pc);
        if (this.links.get(from) !== l) return;
        this.mp.signal(from, { sdp: { type: 'answer', sdp: l.pc.localDescription!.sdp } });
      } else {
        const l = this.links.get(from);
        if (l && l.pc.signalingState === 'have-local-offer') await l.pc.setRemoteDescription({ type: 'answer', sdp: sdp.sdp });
      }
    } catch {
      this.drop(from);
    }
  }

  /** Their voice, into the game's audio, from where they stand. */
  private hear(l: Link, stream: MediaStream) {
    const a = this.audio();
    if (!a || l.panner) return;
    // Chrome only lets remote WebRTC audio flow into Web Audio if an element is playing it too (muted)
    l.el = new Audio();
    l.el.muted = true;
    l.el.srcObject = stream;
    l.el.play().catch(() => {});
    const src = a.ctx.createMediaStreamSource(stream);
    l.gain = a.ctx.createGain();
    l.gain.gain.value = 0;
    l.meter = a.ctx.createAnalyser();
    l.meter.fftSize = 256;
    l.panner = new PannerNode(a.ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 2.5, rolloffFactor: 1.6, maxDistance: 45 });
    src.connect(l.meter);
    src.connect(l.gain).connect(l.panner).connect(a.out);
  }

  private drop(id: string) {
    const l = this.links.get(id);
    if (!l) return;
    this.links.delete(id);
    l.pc.close();
    l.panner?.disconnect();
    l.gain?.disconnect();
    if (l.el) l.el.srcObject = null;
  }
}

/** Wait until the offer/answer has its network candidates in it (or give up after 2.5 s). */
function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((res) => {
    const t = setTimeout(res, 2500);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        res();
      }
    });
  });
}
