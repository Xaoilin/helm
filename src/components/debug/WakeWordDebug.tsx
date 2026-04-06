import { useState, useRef, useCallback } from 'react';
import { useApp } from '../../store/AppContext';
import WakeWordEngine from 'openwakeword-wasm-browser';
import { TIMING } from '../../config/constants';

interface LogEntry {
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export default function WakeWordDebug() {
  const app = useApp();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'running' | 'error'>('idle');
  const [micLevel, setMicLevel] = useState(0);
  const engineRef = useRef<InstanceType<typeof WakeWordEngine> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number>(0);

  const log = useCallback((level: LogEntry['level'], message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
    setLogs(prev => [...prev, { time, level, message }]);
  }, []);

  const clearLogs = () => setLogs([]);

  // ── Step 1: Check Settings ──
  const checkSettings = () => {
    log('info', '── Step 1: Checking Settings ──');
    log(app.settings.assistantEnabled !== false ? 'success' : 'error',
      `Voice assistant enabled: ${app.settings.assistantEnabled !== false}`);
    log(app.settings.wakeWordEnabled === true ? 'success' : 'error',
      `Wake word enabled: ${app.settings.wakeWordEnabled === true}`);
    if (!app.settings.wakeWordEnabled) {
      log('warn', 'Wake word is disabled in Settings → Voice Assistant. Enable it first.');
    }
  };

  // ── Step 2: Check Model Files ──
  const checkModels = async () => {
    log('info', '── Step 2: Checking ONNX Model Files ──');
    const base = `${import.meta.env.BASE_URL}openwakeword/models`;
    const files = [
      { name: 'hey_lina.onnx', desc: 'Wake word model' },
      { name: 'melspectrogram.onnx', desc: 'Audio preprocessing' },
      { name: 'embedding_model.onnx', desc: 'Feature extraction' },
      { name: 'silero_vad.onnx', desc: 'Voice activity detection' },
    ];

    for (const file of files) {
      try {
        const resp = await fetch(`${base}/${file.name}`);
        const size = resp.headers.get('content-length');
        if (resp.ok) {
          const blob = await resp.blob();
          log('success', `✓ ${file.name} (${file.desc}) — ${(blob.size / 1024).toFixed(1)} KB, status ${resp.status}`);
        } else {
          log('error', `✗ ${file.name} (${file.desc}) — HTTP ${resp.status} ${resp.statusText}. Size header: ${size}`);
        }
      } catch (e) {
        log('error', `✗ ${file.name} (${file.desc}) — Failed to fetch: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
  };

  // ── Step 3: Check Microphone Access ──
  const checkMic = async () => {
    log('info', '── Step 3: Checking Microphone Access ──');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      log('info', `Found ${mics.length} microphone(s):`);
      mics.forEach((mic, i) => {
        const selected = mic.deviceId === app.settings.microphoneDeviceId;
        log('info', `  ${i + 1}. ${mic.label || 'Unnamed'} ${selected ? '← SELECTED' : ''}`);
      });

      const constraints: MediaStreamConstraints = {
        audio: app.settings.microphoneDeviceId
          ? { deviceId: { exact: app.settings.microphoneDeviceId } }
          : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getAudioTracks()[0];
      log('success', `✓ Mic access granted: ${track.label}`);
      log('info', `  Sample rate: ${track.getSettings().sampleRate || 'unknown'}`);
      log('info', `  Channel count: ${track.getSettings().channelCount || 'unknown'}`);

      // Brief level check
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      await new Promise(r => setTimeout(r, 500));
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
      log('info', `  Current audio level: ${Math.round(avg)} (0=silent, 128=loud)`);
      if (avg < 5) log('warn', '  ⚠ Very quiet — is the mic muted or too far away?');

      stream.getTracks().forEach(t => t.stop());
      audioCtx.close();
    } catch (e) {
      log('error', `✗ Mic access failed: ${e instanceof Error ? e.message : 'unknown'}`);
      if (e instanceof Error && e.message.includes('NotAllowed')) {
        log('warn', '  Click the lock/shield icon in your browser address bar → allow microphone');
      }
    }
  };

  // ── Step 4: Initialize Wake Word Engine ──
  const initEngine = async () => {
    log('info', '── Step 4: Initializing OpenWakeWord Engine ──');
    setEngineState('loading');

    // Stop any existing engine
    if (engineRef.current) {
      try {
        await engineRef.current.stop();
      } catch (error) {
        console.debug('WakeWordDebug stop before reinit failed', error);
      }
      engineRef.current = null;
    }

    const base = `${import.meta.env.BASE_URL}openwakeword/models`;
    log('info', `Base URL: ${base}`);
    log('info', `Keywords: ["hey_lina"]`);
    log('info', `Detection threshold: 0.5`);
    log('info', `Cooldown: ${TIMING.WAKE_WORD_COOLDOWN}ms`);

    try {
      const engine = new WakeWordEngine({
        keywords: ['hey_lina'],
        modelFiles: { hey_lina: 'hey_lina.onnx' },
        baseAssetUrl: base,
        detectionThreshold: 0.5,
        cooldownMs: TIMING.WAKE_WORD_COOLDOWN,
        debug: true,
      });

      // Hook up ALL events
      engine.on('detect', ({ keyword, score }: { keyword: string; score: number }) => {
        log('success', `🎉 WAKE WORD DETECTED: "${keyword}" (score: ${score.toFixed(3)})`);
      });

      engine.on('ready', () => {
        log('success', '✓ Engine ready event fired');
      });

      engine.on('speech-start', () => {
        log('info', '🗣️ Speech started (VAD detected voice)');
      });

      engine.on('speech-end', () => {
        log('info', '🔇 Speech ended (VAD silence detected)');
      });

      engine.on('error', (e: Error) => {
        log('error', `Engine error: ${e.message}`);
      });

      log('info', 'Calling engine.load()...');
      await engine.load();
      log('success', '✓ Engine loaded successfully');

      log('info', 'Calling engine.start()...');
      await engine.start();
      log('success', '✓ Engine started — listening for "Hey Lina"');

      engineRef.current = engine;
      setEngineState('running');

      // Start mic level monitoring
      startLevelMonitor();

    } catch (e) {
      log('error', `✗ Engine failed: ${e instanceof Error ? e.message : 'unknown'}`);
      if (e instanceof Error) {
        log('error', `  Stack: ${e.stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
      setEngineState('error');
    }
  };

  // ── Level Monitor ──
  const startLevelMonitor = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: app.settings.microphoneDeviceId
          ? { deviceId: { exact: app.settings.microphoneDeviceId } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, v) => sum + v, 0) / dataArray.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animRef.current = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch {
      // Level monitoring is optional
    }
  };

  // ── Stop Engine ──
  const stopEngine = async () => {
    log('info', 'Stopping engine...');
    cancelAnimationFrame(animRef.current);
    setMicLevel(0);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    analyserRef.current = null;

    if (engineRef.current) {
      try {
        await engineRef.current.stop();
      } catch (error) {
        console.debug('WakeWordDebug stop failed', error);
      }
      engineRef.current = null;
    }
    setEngineState('idle');
    log('info', 'Engine stopped.');
  };

  // ── Run All Checks ──
  const runAllChecks = async () => {
    clearLogs();
    log('info', '═══ WAKE WORD DIAGNOSTIC ═══');
    log('info', `Browser: ${navigator.userAgent.match(/(Chrome|Brave|Firefox|Safari)\/[\d.]+/)?.[0] || 'unknown'}`);
    log('info', `Platform: ${navigator.platform}`);
    log('info', `Secure context: ${window.isSecureContext}`);
    log('info', `AudioContext: ${typeof AudioContext !== 'undefined' ? 'available' : 'MISSING'}`);
    log('info', `MediaRecorder: ${typeof MediaRecorder !== 'undefined' ? 'available' : 'MISSING'}`);
    log('info', `AudioWorklet: ${typeof AudioWorkletNode !== 'undefined' ? 'available' : 'MISSING'}`);
    log('info', '');

    checkSettings();
    log('info', '');
    await checkModels();
    log('info', '');
    await checkMic();
    log('info', '');
    await initEngine();
    log('info', '');
    log('info', '═══ DIAGNOSTIC COMPLETE ═══');
    log('info', 'If engine is running, try saying "Hey Lina" now. Watch for detection events above.');
    log('info', 'The level meter shows your mic input. Green bars = voice detected.');
  };

  const levelColor = micLevel > 60 ? '#22c55e' : micLevel > 20 ? '#f59e0b' : '#4a4e63';

  return (
    <div>
      {/* Controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={runAllChecks}>
            🔍 Run Full Diagnostic
          </button>
          <button className="btn btn-secondary btn-sm" onClick={checkSettings}>Settings</button>
          <button className="btn btn-secondary btn-sm" onClick={checkModels}>Models</button>
          <button className="btn btn-secondary btn-sm" onClick={checkMic}>Mic</button>
          <button className="btn btn-secondary btn-sm" onClick={initEngine} disabled={engineState === 'loading'}>
            {engineState === 'loading' ? 'Loading...' : 'Init Engine'}
          </button>
          {engineState === 'running' && (
            <button className="btn btn-danger btn-sm" onClick={stopEngine}>Stop Engine</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={clearLogs} style={{ marginLeft: 'auto' }}>Clear Logs</button>
        </div>

        {/* Engine status + level meter */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            Engine: {' '}
            <span style={{ color: engineState === 'running' ? '#22c55e' : engineState === 'error' ? '#ff6b6b' : engineState === 'loading' ? '#f59e0b' : '#6b6f85' }}>
              {engineState.toUpperCase()}
            </span>
          </span>
          {engineState === 'running' && (
            <>
              <span style={{ fontSize: 11, color: '#6b6f85' }}>Mic level:</span>
              <div style={{ flex: 1, maxWidth: 200, height: 10, background: '#1a1d2e', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${micLevel}%`, height: '100%', background: levelColor, transition: 'width 0.1s', borderRadius: 5 }} />
              </div>
              <span style={{ fontSize: 10, color: '#6b6f85', minWidth: 30 }}>{micLevel}%</span>
            </>
          )}
        </div>
      </div>

      {/* Log output */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2030', fontSize: 12, fontWeight: 600, color: '#8b8fa3' }}>
          Diagnostic Log ({logs.length} entries)
        </div>
        <div style={{
          height: 400, overflowY: 'auto', padding: '8px 12px',
          fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
          background: '#0a0c12',
        }}>
          {logs.length === 0 && (
            <div style={{ color: '#4a4e63', padding: 20, textAlign: 'center' }}>
              Click "Run Full Diagnostic" to start troubleshooting the wake word.
            </div>
          )}
          {logs.map((entry, i) => (
            <div key={i} style={{ color: logColor(entry.level) }}>
              <span style={{ color: '#4a4e63' }}>[{entry.time}]</span>{' '}
              {entry.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function logColor(level: LogEntry['level']): string {
  switch (level) {
    case 'success': return '#22c55e';
    case 'error': return '#ff6b6b';
    case 'warn': return '#f59e0b';
    default: return '#e1e4ea';
  }
}
