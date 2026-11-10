// Landing page: the promotional copy, its choreography with the robot, and the
// live 3D hero. Nothing here touches authentication, the chat or the API.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The copy module runs on its own so the words start immediately, before this
// heavyweight scene has finished loading. It leaves its gesture cues here.
const cues = window.vicCues || { nod: null, wave: null, present: null };

/* ------------------------------------------------------------------ */
/* the hero robot                                                      */
/* ------------------------------------------------------------------ */

const art = document.getElementById("heroArt");
const canvas = document.getElementById("heroCanvas");

function initHero() {
    if (!art || !canvas || reduceMotion) {
        return;
    }

    let renderer;

    try {
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance"
        });
    } catch (error) {
        return; // the poster stays, which is a full-quality still of this scene
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.35, 8);

    /* ---------- environment: soft violet studio ---------- */

    function buildEnvironment() {
        const size = 512;
        const envCanvas = document.createElement("canvas");
        envCanvas.width = size;
        envCanvas.height = size / 2;
        const ctx = envCanvas.getContext("2d");

        ctx.fillStyle = "#0A0A1F";
        ctx.fillRect(0, 0, envCanvas.width, envCanvas.height);

        const blobs = [
            [0.24, 0.28, 0.3, "rgba(196, 181, 253, 0.95)"],
            [0.72, 0.22, 0.26, "rgba(192, 38, 211, 0.7)"],
            [0.5, 0.62, 0.4, "rgba(124, 58, 237, 0.5)"],
            [0.86, 0.68, 0.22, "rgba(233, 213, 255, 0.55)"]
        ];

        blobs.forEach(([x, y, r, color]) => {
            const gradient = ctx.createRadialGradient(
                x * envCanvas.width,
                y * envCanvas.height,
                0,
                x * envCanvas.width,
                y * envCanvas.height,
                r * envCanvas.width
            );
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, envCanvas.width, envCanvas.height);
        });

        const texture = new THREE.CanvasTexture(envCanvas);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        const pmrem = new THREE.PMREMGenerator(renderer);
        const envMap = pmrem.fromEquirectangular(texture).texture;
        pmrem.dispose();
        texture.dispose();
        scene.environment = envMap;
    }

    buildEnvironment();

    /* ---------- lights ---------- */

    const key = new THREE.DirectionalLight(0xF5F3FF, 2.6);
    key.position.set(3.4, 5.2, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0006;
    key.shadow.radius = 3;
    scene.add(key);

    const rim = new THREE.SpotLight(0xC026D3, 26, 16, 0.8, 0.5, 1.6);
    rim.position.set(-4.4, 2.6, -3.4);
    scene.add(rim);

    const fill = new THREE.PointLight(0xA78BFA, 12, 14, 2);
    fill.position.set(2.2, -0.6, 3.4);
    scene.add(fill);

    scene.add(new THREE.HemisphereLight(0xC4B5FD, 0x150A33, 0.55));

    /* ---------- materials ---------- */

    const shell = new THREE.MeshPhysicalMaterial({
        color: 0x5B21B6,
        metalness: 0.86,
        roughness: 0.3,
        clearcoat: 0.5,
        clearcoatRoughness: 0.28,
        envMapIntensity: 1.25
    });

    const shellLight = new THREE.MeshPhysicalMaterial({
        color: 0x7C3AED,
        metalness: 0.7,
        roughness: 0.32,
        clearcoat: 0.65,
        clearcoatRoughness: 0.2,
        envMapIntensity: 1.35
    });

    const chrome = new THREE.MeshPhysicalMaterial({
        color: 0xC4B5FD,
        metalness: 1,
        roughness: 0.14,
        clearcoat: 0.9,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.6
    });

    const joint = new THREE.MeshStandardMaterial({
        color: 0x2E1065,
        metalness: 0.9,
        roughness: 0.42
    });

    const glass = new THREE.MeshPhysicalMaterial({
        color: 0x0B0B22,
        metalness: 0.4,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.8
    });

    const glow = new THREE.MeshStandardMaterial({
        color: 0xE9D5FF,
        emissive: 0xD8B4FE,
        emissiveIntensity: 3.4,
        roughness: 0.35
    });

    const coreGlow = new THREE.MeshStandardMaterial({
        color: 0xF5F3FF,
        emissive: 0xA855F7,
        emissiveIntensity: 4.2,
        roughness: 0.28
    });

    const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0xC084FC,
        emissive: 0x8B5CF6,
        emissiveIntensity: 2.6,
        metalness: 0.4,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9
    });

    /* ---------- the robot ---------- */

    const subject = new THREE.Group();
    const robot = new THREE.Group();
    subject.add(robot);

    function addMesh(geometry, material, position, parent = robot) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(position[0], position[1], position[2]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    }

    // torso
    addMesh(new RoundedBoxGeometry(1.46, 1.62, 0.94, 5, 0.26), shell, [0, 0.1, 0]);
    addMesh(new RoundedBoxGeometry(1.02, 0.74, 0.14, 4, 0.12), shellLight, [0, 0.16, 0.47]);
    addMesh(new RoundedBoxGeometry(1.2, 0.24, 0.86, 4, 0.1), joint, [0, -0.72, 0]);

    const core = addMesh(new THREE.SphereGeometry(0.17, 32, 32), coreGlow, [0, 0.18, 0.56]);
    const coreHalo = addMesh(new THREE.TorusGeometry(0.27, 0.02, 16, 64), ringMaterial, [0, 0.18, 0.56]);
    coreHalo.rotation.x = 0;

    // vents
    [-0.4, 0.4].forEach((x) => {
        addMesh(new RoundedBoxGeometry(0.16, 0.3, 0.06, 3, 0.03), joint, [x, 0.05, 0.47]);
    });

    // neck
    addMesh(new THREE.CylinderGeometry(0.15, 0.19, 0.2, 32), joint, [0, 0.98, 0]);

    // head
    const head = new THREE.Group();
    head.position.set(0, 1.44, 0);
    robot.add(head);

    addMesh(new RoundedBoxGeometry(1.24, 0.94, 0.96, 6, 0.3), shell, [0, 0, 0], head);
    addMesh(new RoundedBoxGeometry(0.86, 0.12, 0.72, 3, 0.05), shellLight, [0, 0.45, 0], head);

    // visor + eyes
    addMesh(new RoundedBoxGeometry(1.04, 0.5, 0.2, 5, 0.18), glass, [0, 0.02, 0.46], head);

    const eyes = new THREE.Group();
    head.add(eyes);
    [-0.22, 0.22].forEach((x) => {
        addMesh(new THREE.CapsuleGeometry(0.075, 0.13, 6, 24), glow, [x, 0.04, 0.55], eyes);
    });

    // ear pods
    [-0.66, 0.66].forEach((x) => {
        const ear = addMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.14, 32), chrome, [x, 0.02, 0], head);
        ear.rotation.z = Math.PI / 2;
    });

    // antenna
    addMesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 16), chrome, [0, 0.68, 0], head);
    const antennaTip = addMesh(new THREE.SphereGeometry(0.075, 24, 24), glow, [0, 0.9, 0], head);

    // arms
    const arms = {};

    [-1, 1].forEach((side) => {
        const arm = new THREE.Group();
        arm.position.set(side * 0.86, 0.5, 0);
        robot.add(arm);

        addMesh(new THREE.SphereGeometry(0.23, 28, 28), shellLight, [0, 0, 0], arm);

        const upper = addMesh(new THREE.CapsuleGeometry(0.115, 0.42, 8, 24), shell, [side * 0.03, -0.34, 0], arm);
        upper.rotation.z = side * 0.06;

        const elbow = addMesh(new THREE.SphereGeometry(0.115, 24, 24), joint, [side * 0.05, -0.6, 0], arm);

        const fore = addMesh(new THREE.CapsuleGeometry(0.1, 0.36, 8, 24), shellLight, [side * 0.06, -0.84, 0.02], arm);
        fore.rotation.z = side * 0.03;

        addMesh(new RoundedBoxGeometry(0.2, 0.22, 0.2, 3, 0.07), chrome, [side * 0.07, -1.08, 0.03], arm);

        arms[side < 0 ? "left" : "right"] = arm;
    });

    // legs
    [-0.36, 0.36].forEach((x) => {
        addMesh(new THREE.CapsuleGeometry(0.145, 0.4, 8, 24), shell, [x, -1.12, 0]);
        addMesh(new THREE.SphereGeometry(0.125, 24, 24), joint, [x, -1.4, 0]);
        addMesh(new RoundedBoxGeometry(0.34, 0.2, 0.56, 4, 0.08), shellLight, [x, -1.56, 0.09]);
        addMesh(new RoundedBoxGeometry(0.36, 0.06, 0.58, 3, 0.02), chrome, [x, -1.66, 0.09]);
    });

    // shoulder pads
    [-1, 1].forEach((side) => {
        const pad = addMesh(new RoundedBoxGeometry(0.46, 0.3, 0.66, 4, 0.12), shell, [side * 0.82, 0.62, 0]);
        pad.rotation.z = side * 0.16;
    });

    // energy rings around him
    const ringA = addMesh(new THREE.TorusGeometry(1.32, 0.012, 12, 160), ringMaterial, [0, 0.16, 0], subject);
    ringA.rotation.x = Math.PI / 2.12;

    const ringB = addMesh(new THREE.TorusGeometry(1.06, 0.008, 12, 140), ringMaterial, [0, 0.16, 0], subject);
    ringB.rotation.x = Math.PI / 1.86;

    const halo = addMesh(new THREE.TorusGeometry(1.78, 0.006, 10, 180), ringMaterial, [0, 0.1, -0.5], subject);
    halo.material = ringMaterial.clone();
    halo.material.opacity = 0.35;

    // platform
    const platform = new THREE.Group();
    platform.position.y = -1.78;
    subject.add(platform);

    addMesh(new THREE.CylinderGeometry(1.28, 1.4, 0.12, 72), joint, [0, 0, 0], platform);
    const platformRing = addMesh(new THREE.TorusGeometry(1.3, 0.022, 16, 140), ringMaterial, [0, 0.055, 0], platform);
    platformRing.rotation.x = Math.PI / 2;
    addMesh(new THREE.TorusGeometry(0.92, 0.01, 12, 120), ringMaterial, [0, 0.056, 0], platform)
        .rotation.x = Math.PI / 2;

    // contact shadow
    const shadowPlane = new THREE.Mesh(
        new THREE.CircleGeometry(1.62, 64),
        new THREE.ShadowMaterial({ color: 0x05050F, opacity: 0.55 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.84;
    shadowPlane.receiveShadow = true;
    subject.add(shadowPlane);

    robot.position.y = 0.28;
    scene.add(subject);

    /* ---------- floating sparks ---------- */

    const sparkCount = 90;
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkSpeeds = new Float32Array(sparkCount);

    for (let i = 0; i < sparkCount; i += 1) {
        sparkPositions[i * 3] = (Math.random() - 0.5) * 6.4;
        sparkPositions[i * 3 + 1] = (Math.random() - 0.5) * 4.4;
        sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 3.4;
        sparkSpeeds[i] = 0.08 + Math.random() * 0.22;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));

    const sparks = new THREE.Points(
        sparkGeometry,
        new THREE.PointsMaterial({
            color: 0xE9D5FF,
            size: 0.045,
            transparent: true,
            opacity: 0.75,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        })
    );
    scene.add(sparks);

    /* ---------- optional bloom ---------- */

    let composer = null;

    async function setupBloom() {
        try {
            const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
                import("three/addons/postprocessing/EffectComposer.js"),
                import("three/addons/postprocessing/RenderPass.js"),
                import("three/addons/postprocessing/UnrealBloomPass.js"),
                import("three/addons/postprocessing/OutputPass.js")
            ]);

            const size = new THREE.Vector2();
            renderer.getSize(size);

            composer = new EffectComposer(renderer);
            composer.addPass(new RenderPass(scene, camera));
            composer.addPass(new UnrealBloomPass(size, 0.62, 0.75, 0.72));
            composer.addPass(new OutputPass());
        } catch (error) {
            composer = null; // renders without bloom, which still looks right
        }
    }

    /* ---------- framing ---------- */

    const subjectBox = new THREE.Box3().setFromObject(subject);
    const subjectSphere = subjectBox.getBoundingSphere(new THREE.Sphere());
    let baseDistance = 8;
    let focusX = 0;
    let focusY = subjectSphere.center.y;

    function fitCamera() {
        const verticalFov = THREE.MathUtils.degToRad(camera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const limiting = Math.min(verticalFov, horizontalFov);

        // 0.86 fills most of the frame without letting the platform crop.
        baseDistance = (subjectSphere.radius / Math.sin(limiting / 2)) * 0.86;

        // On the wide desktop frame the words sit on the left, so Vic stands
        // right of centre. When the layout stacks, Vic centres instead.
        const stacked = window.matchMedia("(max-width: 980px)").matches;
        const wide = !stacked && camera.aspect > 1.28;
        const halfWidth = Math.tan(horizontalFov / 2) * baseDistance;
        focusX = wide ? -halfWidth * 0.3 : 0;
        focusY = subjectSphere.center.y;

        camera.position.z = baseDistance;
        camera.position.x = focusX * 0.34;
        camera.position.y = focusY + 0.18;
        camera.lookAt(focusX, focusY, 0);
    }

    function resize() {
        const width = Math.max(art.clientWidth, 1);
        const height = Math.max(art.clientHeight, 1);

        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        fitCamera();

        if (composer) {
            composer.setSize(width, height);
        }
    }

    resize();
    setupBloom();

    /* ---------- pointer parallax ---------- */

    const pointer = { x: 0, y: 0 };
    const pointerTarget = { x: 0, y: 0 };

    art.addEventListener("pointermove", (event) => {
        const rect = art.getBoundingClientRect();
        pointerTarget.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        pointerTarget.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    });

    art.addEventListener("pointerleave", () => {
        pointerTarget.x = 0;
        pointerTarget.y = 0;
    });

    /* ---------- animation ---------- */

    const clock = new THREE.Clock();
    let nextBlinkAt = 2.4;
    let blinkUntil = 0;
    let visible = true;
    let frame = 0;

    function animate() {
        frame = 0;

        if (!visible) {
            return;
        }

        frame = requestAnimationFrame(animate);

        const time = clock.getElapsedTime();
        const now = performance.now();

        pointer.x += (pointerTarget.x - pointer.x) * 0.05;
        pointer.y += (pointerTarget.y - pointer.y) * 0.05;

        // float and turn toward the pointer
        subject.position.y = Math.sin(time * 1.05) * 0.075;
        robot.rotation.y = pointer.x * 0.22 + Math.sin(time * 0.34) * 0.06;
        robot.rotation.z = Math.sin(time * 0.6) * 0.012;

        // head life
        let headX = -pointer.y * 0.16 + Math.sin(time * 0.7) * 0.03;
        let headY = pointer.x * 0.3;

        const nodAge = cues.nod ? (now - cues.nod) / 1000 : 99;
        if (nodAge < 1.1) {
            const envelope = Math.max(0, 1 - nodAge / 1.1);
            headX += Math.sin(nodAge * 7.6) * 0.17 * envelope;
            headY += Math.sin(nodAge * 5.2) * 0.06 * envelope;
        }

        head.rotation.x += (headX - head.rotation.x) * 0.18;
        head.rotation.y += (headY - head.rotation.y) * 0.18;

        // the wave that salutes each new line
        const waveAge = cues.wave ? (now - cues.wave) / 1000 : 99;
        const waveEnvelope = waveAge < 1.9 ? Math.max(0, 1 - waveAge / 1.9) : 0;
        const armSwing = waveEnvelope * (Math.sin(waveAge * 9.4) * 0.42 + 0.72);

        if (arms.right) {
            arms.right.rotation.z = -armSwing;
            arms.right.rotation.x = waveEnvelope * 0.22;
        }

        const presentAge = cues.present ? (now - cues.present) / 1000 : 99;
        const presentEnvelope = presentAge < 1.5 ? Math.max(0, 1 - presentAge / 1.5) : 0;

        if (arms.left) {
            arms.left.rotation.z =
                Math.sin(time * 0.9) * 0.05 +
                presentEnvelope * (0.86 + Math.sin(presentAge * 5.4) * 0.1);
            arms.left.rotation.x = presentEnvelope * 0.16;
        }

        // blinking
        if (time > nextBlinkAt) {
            blinkUntil = now + 130;
            nextBlinkAt = time + 2.6 + Math.random() * 2.8;
        }

        const blinkScale = now < blinkUntil ? 0.12 : 1;
        eyes.scale.y += (blinkScale - eyes.scale.y) * 0.45;

        // pulsing glow
        const pulse = 0.6 + Math.sin(time * 2.1) * 0.4;
        coreGlow.emissiveIntensity = 3.2 + pulse * 1.6;
        glow.emissiveIntensity = 2.6 + pulse * 1.1;
        core.scale.setScalar(1 + pulse * 0.05);
        coreHalo.rotation.z = time * 0.5;
        antennaTip.scale.setScalar(1 + pulse * 0.16);

        ringA.rotation.z = time * 0.22;
        ringB.rotation.z = -time * 0.16;
        halo.rotation.z = time * 0.08;
        platformRing.rotation.z = time * 0.3;

        // sparks drift upward and wrap
        const positions = sparkGeometry.attributes.position.array;
        for (let i = 0; i < sparkCount; i += 1) {
            positions[i * 3 + 1] += sparkSpeeds[i] * 0.016;
            if (positions[i * 3 + 1] > 2.4) {
                positions[i * 3 + 1] = -2.4;
            }
        }
        sparkGeometry.attributes.position.needsUpdate = true;
        sparks.rotation.y = time * 0.05;

        // gentle camera drift
        camera.position.x = focusX * 0.34 + pointer.x * 0.16;
        camera.position.y = focusY + 0.18 - pointer.y * 0.1 + Math.sin(time * 0.5) * 0.04;
        camera.lookAt(focusX, focusY, 0);

        if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }

        if (!art.classList.contains("is-live")) {
            art.classList.add("is-live");
        }
    }

    function start() {
        if (!visible || frame) {
            return;
        }

        animate();
    }

    function stop() {
        if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
    }

    if ("IntersectionObserver" in window) {
        const visibilityObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                visible = entry.isIntersecting;
                if (visible) {
                    start();
                } else {
                    stop();
                }
            });
        }, { threshold: 0.05 });

        visibilityObserver.observe(art);
    } else {
        start();
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stop();
        } else if (visible) {
            start();
        }
    });

    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);

    canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        stop();
        art.classList.remove("is-live");
    });

    canvas.addEventListener("webglcontextrestored", () => {
        resize();
        start();
    });

    start();

    if (new URLSearchParams(window.location.search).has("debug")) {
        window.__vicHero = { THREE, scene, camera, renderer, robot, subject, composer: () => composer };
    }
}

initHero();

