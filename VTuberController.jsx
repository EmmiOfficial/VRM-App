import React, { useState, useEffect, useRef } from 'react';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Settings, Camera, Play, Square } from 'lucide-react';

// Function to dynamically load external scripts
const loadScripts = () => {
  const scripts = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js',
    'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.0.0/lib/three-vrm.min.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'
  ];

  return Promise.all(scripts.map(src => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }));
};

const VTuberController = () => {
  const [isTracking, setIsTracking] = useState(false);
  const [oscSettings, setOscSettings] = useState({ ip: '127.0.0.1', port: 9000 });
  const [selectedCamera, setSelectedCamera] = useState('0');
  const [fps, setFps] = useState(0);
  const [trackingData, setTrackingData] = useState(null);
  const [vrmLoaded, setVrmLoaded] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const vrmCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceDetectorRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastFrameTimeRef = useRef(Date.now());
  const frameCountRef = useRef(0);

  // Three.js and VRM references
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const vrmRef = useRef(null);

  // Initialize Three.js scene and load external libraries
  useEffect(() => {
    const initializeScene = async () => {
      await loadScripts();

      // Create Three.js scene
      sceneRef.current = new THREE.Scene();

      // Create a perspective camera
      const aspect = window.innerWidth / window.innerHeight;
      cameraRef.current = new THREE.PerspectiveCamera(30, aspect, 0.1, 20.0);
      cameraRef.current.position.set(0, 1.4, 1.4);
      cameraRef.current.lookAt(0, 1.4, 0);

      // Create renderer with transparency support
      rendererRef.current = new THREE.WebGLRenderer({
        canvas: vrmCanvasRef.current,
        alpha: true
      });
      rendererRef.current.setSize(640, 480);
      rendererRef.current.setPixelRatio(window.devicePixelRatio);

      // Add lights to the scene
      const light = new THREE.DirectionalLight(0xffffff);
      light.position.set(1, 1, 1).normalize();
      sceneRef.current.add(light);

      const ambientLight = new THREE.AmbientLight(0x404040);
      sceneRef.current.add(ambientLight);

      // Render loop
      const animate = () => {
        requestAnimationFrame(animate);
        if (vrmRef.current && trackingData) {
          const { headRotation, mouthOpenness } = trackingData;

          // Apply head rotation if VRM model has a humanoid
          if (vrmRef.current.humanoid) {
            const neck = vrmRef.current.humanoid.getNormalizedBoneNode('neck');
            if (neck) {
              neck.rotation.y = THREE.MathUtils.degToRad(headRotation.yaw);
              neck.rotation.x = THREE.MathUtils.degToRad(headRotation.pitch);
              neck.rotation.z = THREE.MathUtils.degToRad(headRotation.roll);
            }
          }
          // Apply mouth expression if supported
          if (vrmRef.current.expressionManager) {
            vrmRef.current.expressionManager.setValue('aa', mouthOpenness);
            vrmRef.current.expressionManager.update();
          }
        }
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      };
      animate();
    };

    initializeScene();
  }, [trackingData]);

  // Initialize MediaPipe Face Mesh
  useEffect(() => {
    const initializeFaceDetector = async () => {
      if (window.FaceMesh) {
        faceDetectorRef.current = new window.FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });
        faceDetectorRef.current.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        faceDetectorRef.current.onResults(onFaceDetected);
      }
    };

    initializeFaceDetector();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Callback for face detection using MediaPipe results
  const onFaceDetected = (results) => {
    if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) return;

    const landmarks = results.multiFaceLandmarks[0];
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00FF00';
    landmarks.forEach((landmark) => {
      ctx.beginPath();
      ctx.arc(
        landmark.x * canvas.width,
        landmark.y * canvas.height,
        2,
        0,
        2 * Math.PI
      );
      ctx.fill();
    });

    // Calculate simple face parameters
    const upperLip = landmarks[13];
    const lowerLip = landmarks[14];
    const mouthOpenness = Math.abs(upperLip.y - lowerLip.y);

    // Calculate head rotation using selected landmarks for enhanced accuracy
    const nose = landmarks[4];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];

    const headCenter = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2,
      z: (leftEye.z + rightEye.z) / 2
    };

    const headRotation = {
      yaw: Math.atan2(nose.x - headCenter.x, nose.z - headCenter.z) * (180 / Math.PI),
      pitch: Math.atan2(nose.y - headCenter.y, nose.z - headCenter.z) * (180 / Math.PI),
      roll: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI)
    };

    setTrackingData({ mouthOpenness, headRotation });

    // Update FPS
    frameCountRef.current++;
    const now = Date.now();
    if (now - lastFrameTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFrameTimeRef.current = now;
    }
  };

  // Load VRM model using pixiv/three-vrm
  const loadVRMModel = async (file) => {
    if (!window.THREE || !window.THREE.VRM) {
      console.error('Three.js or VRM loader not initialized');
      return;
    }
    try {
      const loader = new window.THREE.VRMLoader();
      const vrm = await new Promise((resolve, reject) => {
        loader.load(
          URL.createObjectURL(file),
          (vrm) => resolve(vrm),
          undefined,
          reject
        );
      });
      if (vrmRef.current) {
        sceneRef.current.remove(vrmRef.current.scene);
      }
      vrmRef.current = vrm;
      sceneRef.current.add(vrm.scene);
      vrm.scene.position.set(0, 0, 0);
      setVrmLoaded(true);
    } catch (error) {
      console.error('Error loading VRM:', error);
      alert('Error loading VRM model. Please try another file.');
    }
  };

  // Start video tracking
  const startTracking = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: selectedCamera,
          width: 640,
          height: 480
        }
      });
      streamRef.current = stream;
      const videoElement = videoRef.current;
      videoElement.srcObject = stream;
      await new Promise((resolve) => {
        videoElement.onloadedmetadata = resolve;
      });
      videoElement.play();
      canvasRef.current.width = videoElement.videoWidth;
      canvasRef.current.height = videoElement.videoHeight;
      setIsTracking(true);
      const detectFrame = async () => {
        if (!isTracking) return;
        if (faceDetectorRef.current) {
          await faceDetectorRef.current.send({ image: videoElement });
        }
        animationFrameRef.current = requestAnimationFrame(detectFrame);
      };
      detectFrame();
    } catch (error) {
      console.error('Error starting camera:', error);
      alert('Could not access camera. Please ensure you have granted camera permissions.');
    }
  };

  const stopTracking = () => {
    setIsTracking(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setTrackingData(null);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">VTuber VRM Controller</h1>
        
        <div className="grid grid-cols-4 gap-6">
          {/* Settings Panel */}
          <div className="col-span-1 bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">OSC IP</label>
                <input 
                  type="text"
                  value={oscSettings.ip}
                  onChange={(e) => setOscSettings({ ...oscSettings, ip: e.target.value })}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">OSC Port</label>
                <input 
                  type="number"
                  value={oscSettings.port}
                  onChange={(e) => setOscSettings({ ...oscSettings, port: parseInt(e.target.value) })}
                  className="w-full p-2 border rounded"
                  min="1"
                  max="65535"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Camera</label>
                <select 
                  value={selectedCamera}
                  onChange={(e) => setSelectedCamera(e.target.value)}
                  className="w-full p-2 border rounded"
                >
                  {['0', '1', '2', '3', '4'].map((cam) => (
                    <option key={cam} value={cam}>Camera {cam}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">VRM Model</label>
                <input 
                  type="file"
                  accept=".vrm"
                  className="w-full p-2 border rounded"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      loadVRMModel(e.target.files[0]);
                    }
                  }}
                />
              </div>
              <div className="text-sm text-gray-600">FPS: {fps}</div>
              {trackingData && (
                <div className="mt-4 p-4 bg-gray-50 rounded">
                  <h3 className="font-medium mb-2">Tracking Data:</h3>
                  <div className="text-sm">
                    <div>Mouth Openness: {trackingData.mouthOpenness.toFixed(3)}</div>
                    <div>Head Yaw: {trackingData.headRotation.yaw.toFixed(1)}°</div>
                    <div>Head Pitch: {trackingData.headRotation.pitch.toFixed(1)}°</div>
                    <div>Head Roll: {trackingData.headRotation.roll.toFixed(1)}°</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Preview Panel */}
          <div className="col-span-3">
            <div className="bg-white p-6 rounded-lg shadow-md mb-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  Camera Preview
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={startTracking}
                    disabled={isTracking}
                    className="flex items-center gap-1 px-4 py-2 rounded bg-blue-500 text-white"
                  >
                    <Play className="w-4 h-4" />
                    Start
                  </button>
                  <button
                    onClick={stopTracking}
                    disabled={!isTracking}
                    className="flex items-center gap-1 px-4 py-2 rounded bg-red-500 text-white"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                </div>
              </div>
              <div className="relative">
                <video ref={videoRef} style={{ display: 'none' }} />
                <canvas ref={canvasRef} className="absolute top-0 left-0" />
                <canvas ref={vrmCanvasRef} className="w-full h-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VTuberController;