import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { positionAt, orbitPath, groundTrack, satelliteState, displayPosition, orbitDisplayScale, isSatelliteVisible, orbitLabel, temeToScene } from './data';
import { gstime, geodeticToEcf } from 'satellite.js';
import { observerGeodetic } from './visibility';

const cameraScale = state => state.compact ? 0.15625 + 0.84375 * state.orbitScale : 1;

export default function OrbitScene({ satellites, active, bdsTypes, missions, compact, orbitScale, timestamp, selected, onSelect, playing, showOrbits, showLabels, showGrid, view, controlsRef, onReady, observer, suspended }) {
  const mount = useRef(null);
  const label = useRef(null);
  const current = useRef({ satellites, active, bdsTypes, missions, compact, orbitScale, timestamp, selected, onSelect, playing, showOrbits, showLabels, showGrid, view });
  current.current = { satellites, active, bdsTypes, missions, compact, orbitScale, timestamp, selected, onSelect, playing, showOrbits, showLabels, showGrid, view, observer, suspended };

  useEffect(() => {
    const host = mount.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 200);
    const home = new THREE.Vector3(19, 14, 25);
    camera.position.copy(home).multiplyScalar(cameraScale(current.current));
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
    catch { onReady('error'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x080b10, 0);
    host.prepend(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 70;
    controls.autoRotateSpeed = 0.13;
    controlsRef.current = {
      reset: () => { camera.position.copy(home).multiplyScalar(cameraScale(current.current)); controls.target.set(0, 0, 0); controls.update(); },
      zoom: amount => { camera.position.multiplyScalar(amount); camera.position.setLength(THREE.MathUtils.clamp(camera.position.length(), 4, 70)); },
    };

    scene.add(new THREE.AmbientLight(0xb7c8e1, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2e3, 2.8);
    sun.position.set(-4, 6, 7);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x2567bd, 0.65);
    fill.position.set(4, -2, -5);
    scene.add(fill);
    const earthGroup = new THREE.Group();
    const earthGeometry = new THREE.SphereGeometry(1.83, 96, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({ color: 0xd7e9f5, shininess: 14, specular: 0x1b3550 });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    earth.scale.y = 6356.7523 / 6378.137;
    earthGroup.add(earth);
    const observerMarker = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    observerMarker.visible = false;
    earthGroup.add(observerMarker);
    scene.add(earthGroup);
    const loader = new THREE.TextureLoader();
    let disposed = false;
    loader.load('/textures/earth.jpg', texture => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthMaterial.map = texture;
      earthMaterial.needsUpdate = true;
      onReady('ready');
    }, undefined, () => onReady('texture-error'));
    loader.load('/textures/earth-bump.png', texture => {
      if (disposed) { texture.dispose(); return; }
      earthMaterial.bumpMap = texture;
      earthMaterial.bumpScale = 0.035;
      earthMaterial.needsUpdate = true;
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.9, 64, 48), new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(0x458dda) } },
      vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){ vNormal = normalize(normalMatrix * normal); vec4 mvPosition = modelViewMatrix * vec4(position,1.0); vPosition = -mvPosition.xyz; gl_Position = projectionMatrix * mvPosition; }',
      fragmentShader: 'uniform vec3 glowColor; varying vec3 vNormal; varying vec3 vPosition; void main(){ float intensity = pow(1.0 - max(dot(normalize(vNormal),normalize(vPosition)),0.0), 4.0); gl_FragColor = vec4(glowColor, intensity * 0.48); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(atmosphere);

    const gridGroup = new THREE.Group();
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x7cadd5, transparent: true, opacity: 0.12 });
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const y = Math.sin(latitude * Math.PI / 180) * 1.838;
      const r = Math.cos(latitude * Math.PI / 180) * 1.838;
      const points = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos(i / 128 * Math.PI * 2) * r, y, Math.sin(i / 128 * Math.PI * 2) * r));
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }
    for (let longitude = 0; longitude < 180; longitude += 30) {
      const points = Array.from({ length: 129 }, (_, i) => {
        const a = i / 128 * Math.PI * 2, l = longitude * Math.PI / 180;
        return new THREE.Vector3(Math.cos(a) * Math.cos(l) * 1.838, Math.sin(a) * 1.838, Math.cos(a) * Math.sin(l) * 1.838);
      });
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMaterial));
    }
    earthGroup.add(gridGroup);

    const orbitGroups = new Map();
    satellites.forEach(sat => {
      const orbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: sat.system.color, opacity: sat.system.category === 'remote' ? 0.075 : 0.13, transparent: true, depthWrite: false }));
      orbit.userData.satellite = sat;
      if (!orbitGroups.has(sat.system.id)) orbitGroups.set(sat.system.id, []);
      orbitGroups.get(sat.system.id).push(orbit);
      scene.add(orbit);
    });
    let lastOrbitBucket;
    let lastPositionTime;
    const positions = new Map();
    let previousCameraScale = cameraScale(current.current);

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const context = glowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.12, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.18)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const dotGeometry = new THREE.SphereGeometry(0.06, 8, 6);
    const satMeshes = satellites.map(sat => {
      const mesh = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(sat.system.color).lerp(new THREE.Color('white'), 0.25) }));
      mesh.userData.satellite = sat;
      if (sat.system.category === 'remote') mesh.scale.setScalar(0.72);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: sat.system.color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.4);
      mesh.add(glow);
      scene.add(mesh);
      return mesh;
    });

    const selection = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.205, 40), new THREE.MeshBasicMaterial({ color: 0xf5a35c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    scene.add(selection);
    const selectedOrbit = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf5b87b, transparent: true, opacity: 0.7, depthWrite: false }));
    scene.add(selectedOrbit);
    let lastSelectedId;

    const starPositions = [];
    let seed = 852;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 550; i++) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      starPositions.push(80 * Math.sin(phi) * Math.cos(theta), 80 * Math.cos(phi), 80 * Math.sin(phi) * Math.sin(theta));
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xb2c8de, size: 0.045, transparent: true, opacity: 0.5, sizeAttenuation: true })));

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart = null;
    const pointerDown = event => { pointerStart = [event.clientX, event.clientY]; };
    const pointerUp = event => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // A screen-space hit area keeps the small satellite markers easy to select.
      let best = null, nearest = 15;
      satMeshes.forEach(mesh => {
        if (!mesh.visible) return;
        const projected = mesh.position.clone().project(camera);
        if (projected.z > 1) return;
        const distance = Math.hypot((projected.x - pointer.x) * rect.width / 2, (projected.y - pointer.y) * rect.height / 2);
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const earthHit = raycaster.intersectObject(earth)[0];
        if (earthHit && earthHit.distance < camera.position.distanceTo(mesh.position) - 0.05) return;
        if (distance < nearest) { nearest = distance; best = mesh.userData.satellite; }
      });
      if (best) current.current.onSelect(best);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();
    let animation;
    const animate = () => {
      animation = requestAnimationFrame(animate);
      const state = current.current;
      if (state.view === '2d' || state.suspended) return;
      if (state.timestamp !== lastPositionTime) {
        for (const sat of satellites) positions.set(sat.id, positionAt(sat, state.timestamp));
        lastPositionTime = state.timestamp;
      }
      const nextCameraScale = cameraScale(state);
      if (nextCameraScale !== previousCameraScale) {
        camera.position.multiplyScalar(nextCameraScale / previousCameraScale);
        previousCameraScale = nextCameraScale;
      }
      controls.autoRotate = false;
      controls.update();
      earthGroup.rotation.y = gstime(new Date(state.timestamp));
      observerMarker.visible = !!state.observer;
      if (state.observer) observerMarker.position.set(...temeToScene(geodeticToEcf(observerGeodetic(state.observer)))).multiplyScalar(1.012);
      gridGroup.visible = state.showGrid;
      const bucket = Math.floor(state.timestamp / 300000);
      orbitGroups.forEach((orbits, id) => orbits.forEach(orbit => {
        if (bucket !== lastOrbitBucket) {
          orbit.geometry.dispose();
          orbit.geometry = new THREE.BufferGeometry().setFromPoints(orbitPath(orbit.userData.satellite, state.timestamp).map(point => new THREE.Vector3(...point)));
        }
        orbit.scale.setScalar(orbitDisplayScale(orbit.userData.satellite, state.compact, state.orbitScale));
        orbit.visible = state.showOrbits && isSatelliteVisible(orbit.userData.satellite, state.active, state.bdsTypes, state.missions) && !!positions.get(orbit.userData.satellite.id);
      }));
      lastOrbitBucket = bucket;
      satMeshes.forEach(mesh => {
        const sat = mesh.userData.satellite;
        const position = displayPosition(positions.get(sat.id), state.compact, sat, state.orbitScale);
        mesh.visible = isSatelliteVisible(sat, state.active, state.bdsTypes, state.missions) && !!position;
        if (position) mesh.position.set(...position);
      });
      const selectedPosition = displayPosition(positions.get(state.selected.id), state.compact, state.selected, state.orbitScale);
      const selectedVisible = selectedPosition && satellites.some(sat => sat.id === state.selected.id) && isSatelliteVisible(state.selected, state.active, state.bdsTypes, state.missions);
      selection.visible = !!selectedVisible;
      selectedOrbit.scale.setScalar(orbitDisplayScale(state.selected, state.compact, state.orbitScale));
      selectedOrbit.visible = !!selectedVisible && state.showOrbits;
      if (selectedVisible) {
        const sat = state.selected;
        const pos = new THREE.Vector3(...selectedPosition);
        selection.position.copy(pos);
        selection.quaternion.copy(camera.quaternion);
        selection.material.color.set(sat.system.color);
        if (lastSelectedId !== `${sat.id}-${bucket}`) {
          selectedOrbit.geometry.dispose();
          selectedOrbit.geometry = new THREE.BufferGeometry().setFromPoints(orbitPath(sat, state.timestamp).map(point => new THREE.Vector3(...point)));
          selectedOrbit.material.color.set(sat.system.color);
          lastSelectedId = `${sat.id}-${bucket}`;
        }
        const projected = pos.clone().project(camera);
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const hit = raycaster.intersectObject(earth)[0];
        const behindEarth = hit && hit.distance < camera.position.distanceTo(pos) - 0.05;
        selection.visible = !behindEarth;
        if (label.current) {
          label.current.style.display = state.showLabels && !behindEarth && projected.z < 1 ? 'block' : 'none';
          label.current.style.left = `${(projected.x + 1) / 2 * host.clientWidth}px`;
          label.current.style.top = `${(-projected.y + 1) / 2 * host.clientHeight}px`;
        }
      } else if (label.current) label.current.style.display = 'none';
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      scene.traverse(object => {
        object.geometry?.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => { material.map?.dispose(); material.bumpMap?.dispose(); material.dispose(); });
        }
      });
      glowTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      controlsRef.current = null;
    };
  }, [satellites]);

  return <div className={`orbit-scene ${view === '2d' ? 'scene-hidden' : ''}`} ref={mount} data-scale={compact ? "compact" : "true"} data-orbit-percent={Math.round((compact ? orbitScale : 1) * 100)} aria-label="交互式地球与卫星三维轨道，拖动旋转、滚轮缩放">
    <div className="satellite-label" ref={label}><span style={{ color: selected?.system.color }}>{selected?.name}</span><small>{selected && orbitLabel(selected)} · NORAD {selected?.noradId}</small></div>
  </div>;
}

export function GroundMap({ satellites, active, bdsTypes, missions, timestamp, selected, onSelect, observer }) {
  const bucket = Math.floor(timestamp / 300000);
  const trackHours = selected.type === 'LEO' ? 3 : 24;
  const track = useMemo(() => groundTrack(selected, bucket * 300000, trackHours, trackHours === 3 ? 180 : 288), [selected, bucket, trackHours]);
  const selectedVisible = isSatelliteVisible(selected, active, bdsTypes, missions) && satellites.some(sat => sat.id === selected.id) && satelliteState(selected, timestamp);
  return <div className="ground-map">
    <div className="map-grid" />
    <img src="/textures/earth.jpg" alt="地球等距圆柱投影地图" />
    {selectedVisible && <svg className="ground-track" viewBox="0 0 360 180" preserveAspectRatio="none" aria-label={`选中卫星前后各 ${trackHours / 2} 小时星下点轨迹`}>{track.map((segment, index) => <polyline key={index} points={segment.map(([lon, lat]) => `${lon + 180},${90 - lat}`).join(' ')} fill="none" stroke={selected.system.color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />)}</svg>}
    {observer && <span className="map-observer" style={{ left: `${(observer.longitude + 180) / 360 * 100}%`, top: `${(90 - observer.latitude) / 180 * 100}%` }} title={`观测点 ${observer.latitude}°, ${observer.longitude}°`} aria-label="地面观测点" />}
    {[60, 30, 0, -30, -60].map(lat => <span className="map-latitude" key={lat} style={{ top: `${(90 - lat) / 180 * 100}%` }}>{lat}°</span>)}
    {satellites.filter(s => isSatelliteVisible(s, active, bdsTypes, missions)).map(sat => {
      const state = satelliteState(sat, timestamp);
      if (!state) return null;
      return <button key={sat.id} className={`map-satellite ${selected?.id === sat.id ? 'selected' : ''}`} style={{ left: `${(state.longitude + 180) / 360 * 100}%`, top: `${(90 - state.latitude) / 180 * 100}%`, '--sat-color': sat.system.color }} onClick={() => onSelect(sat)} title={sat.name} aria-label={`选择 ${sat.name}`} />;
    })}
    <span className="map-caption">真实轨道推算 · 选中卫星前后各 {trackHours / 2} h 星下点轨迹</span>
  </div>;
}
