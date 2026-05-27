import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { resolveVoicePrefs, pickBrowserVoice, getBrowserUtterancePitch } from '../utils/voiceCatalog';

const fragmentShader = `
varying vec2 vUv;
varying float noise;
varying vec3 pos;
uniform float time;
uniform sampler2D pointTexture;
uniform vec3 uColor;

void main() {
  vec3 color1 = uColor;
  vec3 color2 = vec3(0.0, 0.8, 1.0);

  float mixValue = (pos.y + 20.0) / 40.0;
  vec3 gradientColor = mix(color1, color2, clamp(mixValue, 0.0, 1.0));

  vec3 foo = gradientColor * (1.2 - 1.5 * noise);
  gl_FragColor = vec4(foo, 1.0) * texture2D(pointTexture, gl_PointCoord);

  if (gl_FragColor.a < 0.9) discard;
}
`;

const vertexShader = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float pnoise(vec3 P, vec3 rep) {
  vec3 Pi0 = mod(floor(P), rep);
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;

  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);

  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);

  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);

  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;

  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);

  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}

uniform float time;
uniform float voiceVolume;

varying vec2 vUv;
varying vec3 pos;
varying float noise;

attribute float size;

float turbulence( vec3 p ) {
  float t = -.5;
  for (float f = 1.0 ; f <= 1.0 ; f++ ) {
    float power = pow( 2.0, f );
    t += abs( pnoise( vec3( power * p ), vec3( 10.0, 10.0, 10.0 ) ) / power );
  }
  return t;
}

void main() {
  vUv = uv * 200.0;

  noise = 10.0 * -.10 * turbulence( .5 * normalize(position) + time );

  float b = 5.0 * pnoise( 0.05 * position, vec3( 100.0 ) );

  float voiceFactor = 1.0 + (voiceVolume * 2.0);
  float displacement = ( (- 10.0 * noise) + b ) * voiceFactor;

  vec3 newPosition = position + (normalize(position) * displacement);
  pos = newPosition;

  vec4 mvPosition = modelViewMatrix * vec4( newPosition, 1.0 );

  gl_PointSize = size * (300.0 / -mvPosition.z) * (1.0 + voiceVolume * 4.0);

  gl_Position = projectionMatrix * mvPosition;
}
`;

function generateCircleTexture() {
  const canvas = document.createElement('canvas');
  const resolution = 64;
  const radius = 32;
  canvas.height = resolution;
  canvas.width = resolution;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.arc(resolution / 2, resolution / 2, radius, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

const Blob2 = ({
  config = {},
  setConfig,
  assistantSettings = { language: 'en-IN', voiceMode: 'female', ttsVoice: 'en-IN-NeerjaNeural', speakingRate: 'normal' },
  assistantEnabled = false,
  isThinkingExternal = false,
  externalResponse = null,
  onVoiceMessage
}) => {
  const mountRef = useRef(null);
  const terminalRef = useRef(null);
  const userTextRef = useRef(null);
  const aiTextRef = useRef(null);
  const statusTextRef = useRef(null);

  const configRef = useRef(config);
  const assistantSettingsRef = useRef(assistantSettings);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    assistantSettingsRef.current = assistantSettings;
  }, [assistantSettings]);

  useEffect(() => {
    let animationFrameId;
    let analyser;
    let dataArr;

    const container = mountRef.current;
    if (!container) return;

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(65, 0, 0);
    camera.lookAt(scene.position);

    // ── HDR Environment Map ──
    const hdrEquirect = new RGBELoader()
      .setPath('https://assets.codepen.io/1692350/')
      .load('istockphoto-1314573738-612x612.hdr');
    hdrEquirect.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdrEquirect;

    // ── Lighting ──
    const ambientLight = new THREE.AmbientLight(0x222244, 0.5);
    scene.add(ambientLight);

    const light1 = new THREE.PointLight(0xffa2a2, 2, 30);
    light1.position.set(0, 0, 15);
    scene.add(light1);

    const light2 = new THREE.PointLight(0x8088ff, 2, 30);
    light2.position.set(0, 0, -15);
    scene.add(light2);

    // ── Point Cloud Sphere ──
    const geo = new THREE.IcosahedronGeometry(20, 30);
    const positions = geo.attributes.position.array;
    const sizes = new Float32Array(positions.length / 3);
    for (let i = 0; i < sizes.length; i++) {
        sizes[i] = 1.0;
    }

    const bufferGeo = new THREE.BufferGeometry();
    bufferGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (geo.attributes.uv) bufferGeo.setAttribute('uv', geo.attributes.uv);
    bufferGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const uniforms = {
      time: { value: 0.0 },
      voiceVolume: { value: 0.0 },
      uColor: { value: new THREE.Color(configRef.current?.color || '#aa3bff') },
      pointTexture: { value: new THREE.CanvasTexture(generateCircleTexture()) }
    };
    uniforms.pointTexture.value.wrapS = THREE.RepeatWrapping;
    uniforms.pointTexture.value.wrapT = THREE.RepeatWrapping;

    const pointMaterial = new THREE.ShaderMaterial({
      uniforms,
      fragmentShader,
      vertexShader,
      transparent: true,
      alphaTest: 0.9,
    });

    const pointSphere = new THREE.Points(bufferGeo, pointMaterial);
    pointSphere.rotation.set(0, Math.PI, 0);
    scene.add(pointSphere);

    // ── Inner Glossy Mesh (HDR Reflections) ──
    const innerGeo = new THREE.IcosahedronGeometry(18.5, 8);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x8866cc,
      metalness: 0.85,
      roughness: 0.15,
      transparent: true,
      opacity: 0.25,
      envMapIntensity: 1.5,
      wireframe: false,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.rotation.set(0, Math.PI, 0);
    scene.add(innerMesh);

    // ── Post-Processing Composer ──
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const afterimagePass = new AfterimagePass();
    afterimagePass.uniforms['damp'].value = configRef.current?.afterimageDamp ?? 0.92;
    composer.addPass(afterimagePass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      configRef.current?.bloomIntensity ?? 2.5, 0.2, 0.5
    );
    composer.addPass(bloomPass);

    // ── Resize ──
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // ── Audio & Speech ──
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    let isMounted = true;
    let recognition = null;
    let audioCtx = null;
    let streamRef = null;
    let hideTerminalTimeout;
    let typingInterval;

    const setTerminalVisible = (visible) => {
      if (!terminalRef.current) return;
      terminalRef.current.classList.toggle('active', visible);
    };

    const updateTerminal = ({ status, user, ai, hold = false }) => {
      if (statusTextRef.current && status) statusTextRef.current.innerText = status;
      if (userTextRef.current && typeof user === 'string') userTextRef.current.innerText = user;
      if (aiTextRef.current && typeof ai === 'string') aiTextRef.current.innerText = ai;

      clearTimeout(hideTerminalTimeout);
      setTerminalVisible(true);

      if (!hold) {
        hideTerminalTimeout = setTimeout(() => {
          if (isMounted) setTerminalVisible(false);
        }, 4500);
      }
    };

    const stripCodeBlocks = (text) => text.replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();

    const typeAiResponse = (text) => new Promise((resolve) => {
      clearInterval(typingInterval);
      const cleanText = stripCodeBlocks(text);
      if (!aiTextRef.current) {
        resolve();
        return;
      }

      aiTextRef.current.innerText = '';
      let index = 0;
      typingInterval = setInterval(() => {
        if (!isMounted || !aiTextRef.current) {
          clearInterval(typingInterval);
          resolve();
          return;
        }

        index += 1;
        aiTextRef.current.innerText = cleanText.slice(0, index);
        if (index >= cleanText.length) {
          clearInterval(typingInterval);
          resolve();
        }
      }, 18);
    });

    const finishVoiceTurn = () => {
      updateTerminal({ status: 'VOICE COMPLETE', hold: false });
      if (recognition) {
        recognition.onend = safeStartRecognition;
        safeStartRecognition();
      }
    };

    const safeStartRecognition = () => {
      if (!recognition || !isMounted || !assistantEnabled) return;
      try {
        recognition.start();
      } catch (error) {
        console.warn('Speech recognition already active or unavailable', error);
      }
    };

    const speakWithBrowserVoice = (text, onDone) => {
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        onDone();
        return;
      }

      const speak = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const prefs = resolveVoicePrefs(assistantSettingsRef.current || {});
        const preferredVoice = pickBrowserVoice(voices, prefs);

        if (preferredVoice) utterance.voice = preferredVoice;
        utterance.lang = preferredVoice?.lang || prefs.language;
        utterance.rate = prefs.utteranceRate;
        utterance.pitch = getBrowserUtterancePitch(prefs.gender);
        utterance.onend = onDone;
        utterance.onerror = onDone;

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      };

      if (window.speechSynthesis.getVoices().length) {
        speak();
      } else {
        window.speechSynthesis.onvoiceschanged = speak;
      }
    };

    const initAudioAndSpeech = async () => {
      try {
        updateTerminal({ status: 'NEXUS LISTENING', user: 'Awaiting voice command...', ai: '', hold: true });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isMounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        streamRef = stream;

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        dataArr = new Uint8Array(analyser.fftSize);

        if (SpeechRec) {
          recognition = new SpeechRec();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = resolveVoicePrefs(assistantSettingsRef.current || {}).language;
          recognition.onstart = () => console.log('Speech recognition started');
          recognition.onerror = e => {
            console.warn('SpeechRec error', e);
            if (e.error === 'not-allowed') {
              updateTerminal({ status: 'MIC ACCESS BLOCKED', user: 'Microphone permission blocked', hold: false });
            }
          };
          recognition.onend = safeStartRecognition;

          recognition.onresult = async (e) => {
            let msg = '';
            let isFinal = false;
            for (let i = e.resultIndex; i < e.results.length; ++i) {
              msg += e.results[i][0].transcript;
              if (e.results[i].isFinal) isFinal = true;
            }
            msg = msg.trim();
            if (!msg) return;

            updateTerminal({ status: isFinal ? 'COMMAND LOCKED' : 'VOICE STREAM', user: msg, hold: true });

            if (isFinal) {
              if (onVoiceMessage) {
                onVoiceMessage(msg);
              }
              recognition.onend = null;
              recognition.stop();
            }
          };
          safeStartRecognition();
        } else {
          updateTerminal({ status: 'UNSUPPORTED BROWSER', user: 'Speech recognition is not supported in this browser', hold: false });
        }
      } catch (e) {
        console.warn('Mic unavailable', e);
        updateTerminal({ status: 'MICROPHONE UNAVAILABLE', user: e.message || 'Microphone unavailable', hold: false });
      }
    };

    if (assistantEnabled) {
      initAudioAndSpeech();
    }

    const handleResponse = async () => {
      if (!isMounted || !externalResponse) return;

      const { text, userMessage, error, audioBase64, audioMimeType } = externalResponse;

      if (error) {
        updateTerminal({ status: 'NEXUS ERROR', user: userMessage, ai: error, hold: false });
        if (assistantEnabled) finishVoiceTurn();
        return;
      }

      updateTerminal({ status: 'NEXUS RESPONDING', user: userMessage, ai: '', hold: true });
      const typedResponse = typeAiResponse(text);

      speechSynthesis.cancel();

      if (audioBase64) {
        const mimeType = audioMimeType || 'audio/mpeg';
        const audio = new Audio(`data:${mimeType};base64,${audioBase64}`);
        const audioFinished = new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = resolve;
        });
        audio.play();
        await Promise.all([typedResponse, audioFinished]);
      } else {
        await typedResponse;
        await new Promise(resolve => speakWithBrowserVoice(text, resolve));
      }

      if (assistantEnabled) {
        finishVoiceTurn();
      } else {
        setTimeout(() => { if (isMounted) setTerminalVisible(false); }, 3000);
      }
    };

    if (externalResponse) handleResponse();

    if (isThinkingExternal && !externalResponse) {
      updateTerminal({ status: 'MODEL THINKING', user: 'Processing request...', ai: 'Analyzing neural pathways...', hold: true });
    }

    let smoothF = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      let raw = 0;
      if (analyser && dataArr) {
        analyser.getByteTimeDomainData(dataArr);
        let sum = 0;
        for (const v of dataArr) {
            const d = (v - 128) / 128;
            sum += d * d;
        }
        raw = Math.sqrt(sum / dataArr.length);
        raw = THREE.MathUtils.clamp(raw * 8.0, 0, 1);
      }

      smoothF += (raw - smoothF) * 0.04;

      const currentConfig = configRef.current;
      uniforms.uColor.value.set(currentConfig.color);

      uniforms.time.value += 0.0015 + (smoothF * 0.03);
      uniforms.voiceVolume.value = smoothF * currentConfig.sensitivity;

      const currentSize = currentConfig.size;
      const dynamicScale = (1.0 + (smoothF * 2.2)) * currentSize;
      pointSphere.scale.set(dynamicScale, dynamicScale, dynamicScale);
      innerMesh.scale.set(dynamicScale, dynamicScale, dynamicScale);

      camera.position.x = 65 - currentConfig.position.x;
      camera.position.y = currentConfig.position.y;

      const rotBase = 0.0015 * (currentConfig.rotationSpeed ?? 1.0);
      pointSphere.rotation.y += rotBase + (smoothF * 0.02);
      innerMesh.rotation.y += rotBase + (smoothF * 0.02);

      // ── Voice-Reactive Bloom ──
      const baseBloom = currentConfig.bloomIntensity ?? 2.5;
      const bloomStrength = (baseBloom * 0.3) + (smoothF * currentConfig.sensitivity * 1.2);
      bloomPass.strength = Math.min(bloomStrength, 5.0);

      // ── Dynamic Afterimage ──
      afterimagePass.uniforms['damp'].value = currentConfig.afterimageDamp ?? 0.92;

      // ── Voice-Reactive Inner Mesh ──
      const voiceGlow = smoothF * currentConfig.sensitivity;
      innerMat.opacity = 0.15 + (voiceGlow * 0.3);
      innerMat.envMapIntensity = 1.0 + (voiceGlow * 2.0);

      composer.render();
    };

    animate();

    return () => {
      isMounted = false;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animationFrameId);

      if (container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      composer.dispose();
      renderer.dispose();
      geo.dispose();
      pointMaterial.dispose();
      innerGeo.dispose();
      innerMat.dispose();

      if (recognition) {
        recognition.onend = null;
        recognition.stop();
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
      }
      if (streamRef) {
        streamRef.getTracks().forEach(track => track.stop());
      }
      clearTimeout(hideTerminalTimeout);
      clearInterval(typingInterval);
    };
  }, [assistantEnabled, assistantSettings.language, assistantSettings.voiceMode, assistantSettings.speakingRate]);

  const handlePointerDown = (e) => {
    if (!config.isDraggable || !setConfig) return;
    mountRef.current.isDown = true;
    mountRef.current.startX = e.clientX;
    mountRef.current.startY = e.clientY;
    mountRef.current.startPosX = config.position.x || 0;
    mountRef.current.startPosY = config.position.y || 0;
  };

  const handlePointerMove = (e) => {
    if (!config.isDraggable || !mountRef.current.isDown || !setConfig) return;
    const dx = (e.clientX - mountRef.current.startX) * 0.15;
    const dy = (e.clientY - mountRef.current.startY) * 0.15;
    setConfig({
      ...config,
      position: {
        x: mountRef.current.startPosX + dx,
        y: mountRef.current.startPosY - dy
      }
    });
  };

  const handlePointerUp = (e) => {
    if(mountRef.current) mountRef.current.isDown = false;
  };

  return (
    <>
      <div
        ref={mountRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0, overflow: 'hidden', cursor: config.isDraggable ? 'grab' : 'default' }}
      />
      <section ref={terminalRef} className="nexus-terminal" aria-live="polite">
        <div className="terminal-chrome">
          <span className="terminal-dot" />
          <span className="terminal-dot" />
          <span className="terminal-dot" />
          <span className="terminal-title">NEXUS VOICE LINK</span>
          <span ref={statusTextRef} className="terminal-status">STANDBY</span>
        </div>

        <div className="terminal-grid">
          <div className="terminal-line">
            <span className="terminal-label">USER</span>
            <p ref={userTextRef}>Press INITIALIZE to connect voice input.</p>
          </div>

          <div className="terminal-line response">
            <span className="terminal-label">NEXUS</span>
            <p ref={aiTextRef}>Realtime response stream will appear here.</p>
          </div>
        </div>
      </section>
    </>
  );
};

export default Blob2;
