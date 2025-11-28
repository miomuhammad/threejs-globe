import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- GLSL SHADERS ---
const vertex = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    uniform float u_time;
    uniform float u_maxExtrusion;

    void main() {
        vec3 newPosition = position;

        if(u_maxExtrusion > 1.0) {
            newPosition.xyz = newPosition.xyz * u_maxExtrusion + sin(u_time);
        } else {
            newPosition.xyz = newPosition.xyz * u_maxExtrusion;
        }

        gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
    }
`;

const fragment = `
    #ifdef GL_ES
    precision mediump float;
    #endif

    uniform float u_time;

    vec3 colorA = vec3(0.196, 0.631, 0.886);
    vec3 colorB = vec3(0.192, 0.384, 0.498);

    void main() {
        float pct = abs(sin(u_time));
        vec3 color = mix(colorA, colorB, pct);
        gl_FragColor = vec4(color, 1.0);
    }
`;
// --- END SHADERS ---

const container = document.querySelector('.container');
const canvas    = document.querySelector('.canvas');

// Global variables
let sizes, scene, camera, renderer, controls, raycaster, mouse;
let isIntersecting, twinkleTime, materials, material, baseMesh;
let minMouseDownFlag, mouseDown, grabbing;

// --- CAPITAL CITIES (sample set; add more if ingin) ---
const capitalCities = [
    { name: "Jakarta",      lat: -6.2088,  lon: 106.8456 },
    { name: "London",       lat: 51.5074,  lon: -0.1278 },
    { name: "Tokyo",        lat: 35.6762,  lon: 139.6503 },
    { name: "New York",     lat: 40.7128,  lon: -74.0060 },
    { name: "Paris",        lat: 48.8566,  lon: 2.3522 },
    { name: "Berlin",       lat: 52.5200,  lon: 13.4050 },
    { name: "Moscow",       lat: 55.7558,  lon: 37.6173 },
    { name: "Singapore",    lat: 1.3521,   lon: 103.8198 },
    { name: "Sydney",       lat: -33.8688, lon: 151.2093 },
    { name: "Los Angeles",  lat: 34.0522,  lon: -118.2437 },
    { name: "Cape Town",    lat: -33.9249, lon: 18.4241 },
    { name: "Dubai",        lat: 25.2048,  lon: 55.2708 },
    { name: "Seoul",        lat: 37.5665,  lon: 126.9780 },
    { name: "Rome",         lat: 41.9028,  lon: 12.4964 },
    { name: "Madrid",       lat: 40.4168,  lon: -3.7038 },
    { name: "Bangkok",      lat: 13.7563,  lon: 100.5018 },
    { name: "Delhi",        lat: 28.6139,  lon: 77.2090 },
    { name: "Cairo",        lat: 30.0444,  lon: 31.2357 },
    { name: "Toronto",      lat: 43.6532,  lon: -79.3832 },
    { name: "Buenos Aires", lat: -34.6037, lon: -58.3816 },
    { name: "Mexico City",  lat: 19.4326,  lon: -99.1332 },
    { name: "Istanbul",     lat: 41.0082,  lon: 28.9784 },
    { name: "Jakarta",      lat: -6.2088,  lon: 106.8456 },
    { name: "Vienna",       lat: 48.2082,  lon: 16.3738 },
    { name: "Hanoi",        lat: 21.0278,  lon: 105.8342 },
    { name: "Lagos",        lat: 6.5244,   lon: 3.3792 },
    { name: "Lisbon",       lat: 38.7223,  lon: -9.1393 },
    { name: "Athens",       lat: 37.9838,  lon: 23.7275 },
    { name: "Kuala Lumpur", lat: 3.1390,   lon: 101.6869 },
    { name: "Jakarta2",     lat: -6.2088,  lon: 106.8456 } // duplicates okay, randomness later
];

// --- INITIALIZATION ---
const setScene = () => {
    sizes = {
        width:  container ? container.offsetWidth : window.innerWidth,
        height: container ? container.offsetHeight : window.innerHeight
    };

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(50, sizes.width / sizes.height, 1, 1000);
    camera.position.z = 100;

    renderer = new THREE.WebGLRenderer({
        canvas: canvas || undefined,
        antialias: false,
        alpha: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const pointLight = new THREE.PointLight(0x081b26, 17, 200);
    pointLight.position.set(-50, 0, 60);
    scene.add(pointLight);
    scene.add(new THREE.HemisphereLight(0xffffbb, 0x080820, 1.5));

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    isIntersecting = false;
    minMouseDownFlag = false;
    mouseDown = false;
    grabbing = false;

    setControls();
    setBaseSphere();
    setShaderMaterial();
    setMap(); // will call setDots() and setCurves() after image load
    resize();
    listenTo();
    render();
};

// Controls
const setControls = () => {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = -2;
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = (Math.PI / 2) - 0.5;
    controls.maxPolarAngle = (Math.PI / 2) + 0.5;
};

// Base sphere
const setBaseSphere = () => {
    const baseSphere = new THREE.SphereGeometry(19.5, 35, 35);
    const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x0b2636,
        transparent: true,
        opacity: 0.9
    });
    baseMesh = new THREE.Mesh(baseSphere, baseMaterial);
    scene.add(baseMesh);
};

// Shader material for dots
const setShaderMaterial = () => {
    twinkleTime = 0.05;
    materials = [];
    material = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: {
            u_time: { value: 1.0 },
            u_maxExtrusion: { value: 1.0 }
        },
        vertexShader: vertex,
        fragmentShader: fragment
    });
};

// --- WORLD MAP DOTS CREATION ---
const setMap = () => {
    let activeLatLon = {};
    const dotSphereRadius = 20;

    const readImageData = (imageData) => {
        for (let i = 0, lon = -180, lat = 90; i < imageData.length; i += 4, lon++) {
            if (!activeLatLon[lat]) activeLatLon[lat] = [];

            const r = imageData[i];
            const g = imageData[i + 1];
            const b = imageData[i + 2];

            if (r < 80 && g < 80 && b < 80) activeLatLon[lat].push(lon);

            if (lon === 180) {
                lon = -180;
                lat--;
            }
        }
    };

    const visibilityForCoordinate = (lon, lat) => {
        if (!activeLatLon[lat] || !activeLatLon[lat].length) return false;
        const closest = activeLatLon[lat].reduce((p, c) =>
            Math.abs(c - lon) < Math.abs(p - lon) ? c : p
        );
        return Math.abs(lon - closest) < 0.5;
    };

    const calcPosFromLatLonRad = (lon, lat) => {
        const phi = (90 - lat) * Math.PI / 180;
        const theta = (lon + 180) * Math.PI / 180;

        const x = -(dotSphereRadius * Math.sin(phi) * Math.cos(theta));
        const z = dotSphereRadius * Math.sin(phi) * Math.sin(theta);
        const y = dotSphereRadius * Math.cos(phi);

        return new THREE.Vector3(x, y, z);
    };

    const createMaterial = (timeValue) => {
        const mat = material.clone();
        if (mat.uniforms && mat.uniforms.u_time) {
            mat.uniforms.u_time.value = timeValue * Math.sin(Math.random());
        }
        materials.push(mat);
        return mat;
    };

    const setDots = () => {
        const dotDensity = 2.5;

        for (let lat = 90, i = 0; lat > -90; lat--, i++) {
            const radius = Math.cos(Math.abs(lat) * Math.PI / 180) * dotSphereRadius;
            const circumference = radius * Math.PI * 2;
            const dotsForLat = Math.max(1, Math.floor(circumference * dotDensity));

            for (let x = 0; x < dotsForLat; x++) {
                const lon = -180 + (x * 360 / dotsForLat);

                if (!visibilityForCoordinate(lon, lat)) continue;

                const vector = calcPosFromLatLonRad(lon, lat);

                const dotGeometry = new THREE.CircleGeometry(0.1, 5);
                // create mesh, set position, orient it to face away from center
                const m = createMaterial(i);
                const mesh = new THREE.Mesh(dotGeometry, m);
                mesh.position.copy(vector);
                // make it face outward: look at twice the position vector (point away from center)
                mesh.lookAt(vector.clone().multiplyScalar(2));
                scene.add(mesh);
            }
        }
    };

    // IMAGE LOAD
    const image = new Image();
    // If you load from external domain, you may need image.crossOrigin = 'anonymous';
    image.onload = () => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        readImageData(imageData.data);

        setDots();
        setCurves(); // call curves after dots are ready
    };
    image.src = 'img/world_alpha_mini.jpg';
};
// --- END DOTS CREATION ---

// --- ARC / CURVE GLOBE (many random routes) ---
const setCurves = () => {

    const R = 20;
    const maxLift = 1.2;    // small lift in middle
    const steps = 120;
    const routeCount = 50;  // jumlah route yang diinginkan

    const deg2rad = d => d * Math.PI / 180;

    const latLonToVec3 = (lat, lon) => {
        const phi = deg2rad(90 - lat);
        const theta = deg2rad(lon + 180);

        return new THREE.Vector3(
            -Math.sin(phi) * Math.cos(theta),
             Math.cos(phi),
             Math.sin(phi) * Math.sin(theta)
        );
    };

    // helper: random index but ensure different start and end
    const randomPair = () => {
        const a = Math.floor(Math.random() * capitalCities.length);
        let b = Math.floor(Math.random() * capitalCities.length);
        while (b === a) b = Math.floor(Math.random() * capitalCities.length);
        return [capitalCities[a], capitalCities[b]];
    };

    for (let r = 0; r < routeCount; r++) {
        const [startCity, endCity] = randomPair();

        const start = latLonToVec3(startCity.lat, startCity.lon).normalize();
        const end   = latLonToVec3(endCity.lat, endCity.lon).normalize();

        const points = [];
        for (let i = 0; i <= 1; i += 1 / steps) {
            // spherical interpolation approx (lerp then normalize)
            const intermediate = start.clone().lerp(end, i).normalize();

            // lift factor peak in middle, 0 at ends
            const t = i * 2 - 1;
            const lift = (1 - t * t) * maxLift;

            points.push(intermediate.multiplyScalar(R + lift));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);

        // color variation by route index
        const hue = (r * 37) % 360; // pseudo-random distribution
        // convert hue to hex-ish — simple mapping: pick blue-ish or cyan-ish tones
        const baseColors = [0x4bb4ff, 0x7ee6ff, 0x2fa3ff, 0x9fdcff];
        const matColor = baseColors[r % baseColors.length];

        const materialLine = new THREE.LineBasicMaterial({
            color: matColor,
            transparent: true,
            opacity: 0.75
        });

        const line = new THREE.Line(geometry, materialLine);
        scene.add(line);
    }
};
// --- END CURVES ---

// Resize
const resize = () => {
    sizes = {
        width: container ? container.offsetWidth : window.innerWidth,
        height: container ? container.offsetHeight : window.innerHeight
    };

    if (window.innerWidth > 700) camera.position.z = 100;
    else camera.position.z = 140;

    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    renderer.setSize(sizes.width, sizes.height);
};

// Mouse move / raycast
const mousemove = (event) => {
    isIntersecting = false;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(baseMesh);
    if (intersects && intersects.length > 0) {
        isIntersecting = true;
        if (!grabbing) document.body.style.cursor = 'pointer';
    } else {
        if (!grabbing) document.body.style.cursor = 'default';
    }
};

const mousedown = () => {
    if (!isIntersecting) return;

    if (Array.isArray(materials)) {
        materials.forEach(el => {
            if (el.uniforms && el.uniforms.u_maxExtrusion) {
                if (typeof gsap !== 'undefined') {
                    gsap.to(el.uniforms.u_maxExtrusion, { value: 1.07 });
                } else {
                    el.uniforms.u_maxExtrusion.value = 1.07;
                }
            }
        });
    }

    mouseDown = true;
    minMouseDownFlag = false;

    setTimeout(() => {
        minMouseDownFlag = true;
        if (!mouseDown) mouseup();
    }, 500);

    document.body.style.cursor = 'grabbing';
    grabbing = true;
};

const mouseup = () => {
    mouseDown = false;
    if (!minMouseDownFlag) return;

    if (Array.isArray(materials)) {
        materials.forEach(el => {
            if (el.uniforms && el.uniforms.u_maxExtrusion) {
                if (typeof gsap !== 'undefined') {
                    gsap.to(el.uniforms.u_maxExtrusion, { value: 1.0, duration: 0.2 });
                } else {
                    el.uniforms.u_maxExtrusion.value = 1.0;
                }
            }
        });
    }

    grabbing = false;
    if (isIntersecting) document.body.style.cursor = 'pointer';
    else document.body.style.cursor = 'default';
};

const listenTo = () => {
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', mousemove);
    window.addEventListener('mousedown', mousedown);
    window.addEventListener('mouseup', mouseup);
};

// Render loop
const render = () => {
    if (Array.isArray(materials)) {
        materials.forEach(el => {
            if (el.uniforms && el.uniforms.u_time) el.uniforms.u_time.value += twinkleTime;
        });
    }

    if (controls) controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(render);
};

setScene();
