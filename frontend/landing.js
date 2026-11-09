// Vic Chatbot landing page: the hero robot, the typed headline and the
// scroll reveals. Presentation only. Nothing here touches authentication.
//
// The 3D robot is drawn in a WebGL canvas with three.js. The page also ships a
// static SVG robot underneath, which stays visible unless a first frame is
// actually drawn, so the hero never shows an empty stage on a device without
// WebGL.

const stage = document.getElementById("robotStage");
const canvas = document.getElementById("robotCanvas");

const reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ==============================
// TYPED HERO HEADLINE
// ==============================

const HEADLINE = "A Brighter Way to Think and Learn";
const typedElement = document.getElementById("heroTyped");

const TYPE_MS = 62;
const SPACE_PAUSE_MS = 100;
const HOLD_MS = 2200;
const GAP_MS = 900;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeHeadline() {
    if (!typedElement) {
        return;
    }

    if (reduceMotion) {
        typedElement.textContent = HEADLINE;
        return;
    }

    typedElement.textContent = "";

    while (true) {
        for (let index = 1; index <= HEADLINE.length; index += 1) {
            typedElement.textContent = HEADLINE.slice(0, index);
            const justTyped = HEADLINE[index - 1];
            await sleep(justTyped === " " ? SPACE_PAUSE_MS : TYPE_MS);
        }

        await sleep(HOLD_MS);
        typedElement.classList.add("is-away");
        await sleep(500);
        typedElement.textContent = "";
        typedElement.classList.remove("is-away");
        await sleep(GAP_MS);
    }
}

typeHeadline();

// ==============================
// SCROLL REVEALS
// ==============================

const revealTargets = Array.from(document.querySelectorAll("[data-reveal]"));

if (reduceMotion || !("IntersectionObserver" in window)) {
    revealTargets.forEach((element) => element.classList.add("is-revealed"));
} else {
    const revealObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add("is-revealed");
                    revealObserver.unobserve(entry.target);
                }
            });
        },
        { rootMargin: "0px 0px -12% 0px", threshold: 0.12 }
    );

    revealTargets.forEach((element) => revealObserver.observe(element));
}

// ==============================
// MOBILE NAV
// ==============================

const navToggle = document.querySelector(".nav-toggle");
const mobileNav = document.getElementById("mobileNav");

if (navToggle && mobileNav) {
    navToggle.addEventListener("click", () => {
        const open = navToggle.getAttribute("aria-expanded") === "true";
        navToggle.setAttribute("aria-expanded", String(!open));
        mobileNav.hidden = open;
    });

    mobileNav.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            navToggle.setAttribute("aria-expanded", "false");
            mobileNav.hidden = true;
        });
    });
}

// ==============================
// 3D ROBOT
// ==============================

async function buildRobot() {
    if (!stage || !canvas || reduceMotion) {
        return;
    }

    let THREE;
    let RoundedBoxGeometry;

    try {
        THREE = await import("three");
        ({ RoundedBoxGeometry } = await import(
            "three/addons/geometries/RoundedBoxGeometry.js"
        ));
    } catch (error) {
        console.warn("3D robot unavailable, keeping the static artwork.", error);
        return;
    }

    let renderer;

    try {
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
        });
    } catch (error) {
        console.warn("WebGL unavailable, keeping the static artwork.", error);
        return;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
    camera.position.set(0, 0.62, 5.2);

    // ---------- environment for metal reflections ----------

    function studioEnvironment() {
        const surface = document.createElement("canvas");
        surface.width = 512;
        surface.height = 256;
        const context = surface.getContext("2d");

        const base = context.createLinearGradient(0, 0, 0, 256);
        base.addColorStop(0, "#1B0E42");
        base.addColorStop(0.45, "#341A72");
        base.addColorStop(0.72, "#1A0F3A");
        base.addColorStop(1, "#08061A");
        context.fillStyle = base;
        context.fillRect(0, 0, 512, 256);

        const blobs = [
            [140, 62, 96, "rgba(233, 213, 255, 0.95)"],
            [370, 88, 120, "rgba(192, 132, 252, 0.85)"],
            [470, 40, 70, "rgba(255, 255, 255, 0.9)"],
            [60, 170, 90, "rgba(124, 58, 237, 0.75)"],
            [300, 200, 110, "rgba(192, 38, 211, 0.55)"],
        ];

        blobs.forEach(([x, y, radius, colour]) => {
            const glow = context.createRadialGradient(x, y, 0, x, y, radius);
            glow.addColorStop(0, colour);
            glow.addColorStop(1, "rgba(0, 0, 0, 0)");
            context.fillStyle = glow;
            context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        });

        const texture = new THREE.CanvasTexture(surface);
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        const generator = new THREE.PMREMGenerator(renderer);
        const target = generator.fromEquirectangular(texture);
        generator.dispose();
        texture.dispose();

        return target.texture;
    }

    scene.environment = studioEnvironment();

    // ---------- lights ----------

    scene.add(new THREE.HemisphereLight(0xc9b3ff, 0x140a2e, 0.7));

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3.4, 5.2, 4.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 18;
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0008;
    scene.add(key);

    const rim = new THREE.SpotLight(0xc026d3, 26, 14, Math.PI / 5, 0.6, 1.4);
    rim.position.set(-4.2, 2.6, -3.4);
    scene.add(rim);

    const fill = new THREE.PointLight(0xa78bfa, 10, 14, 2);
    fill.position.set(2.6, -0.7, 3.4);
    scene.add(fill);

    const under = new THREE.PointLight(0x8b5cf6, 12, 8, 2);
    under.position.set(0, -1.4, 1.2);
    scene.add(under);

    // ---------- materials ----------

    const shell = new THREE.MeshStandardMaterial({
        color: 0x7c3aed,
        metalness: 0.86,
        roughness: 0.26,
    });
    const shellDeep = new THREE.MeshStandardMaterial({
        color: 0x3b1580,
        metalness: 0.9,
        roughness: 0.32,
    });
    const trim = new THREE.MeshStandardMaterial({
        color: 0xa78bfa,
        metalness: 0.95,
        roughness: 0.18,
    });
    const glass = new THREE.MeshStandardMaterial({
        color: 0x120a26,
        metalness: 0.6,
        roughness: 0.12,
    });
    const glow = new THREE.MeshStandardMaterial({
        color: 0xe9d5ff,
        emissive: 0xc084fc,
        emissiveIntensity: 2.4,
        metalness: 0.2,
        roughness: 0.3,
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1038,
        metalness: 0.7,
        roughness: 0.4,
    });

    // ---------- robot ----------

    const robot = new THREE.Group();
    robot.position.y = 0.08;
    robot.scale.setScalar(0.94);
    scene.add(robot);

    function part(geometry, material, position, options = {}) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.castShadow = options.castShadow !== false;
        mesh.receiveShadow = options.receiveShadow !== false;

        if (options.rotation) {
            mesh.rotation.set(...options.rotation);
        }

        (options.parent || robot).add(mesh);
        return mesh;
    }

    // torso
    part(
        new RoundedBoxGeometry(1.44, 1.66, 0.88, 4, 0.26),
        shell,
        [0, 0, 0]
    );
    part(
        new RoundedBoxGeometry(1.02, 0.9, 0.14, 3, 0.14),
        shellDeep,
        [0, 0.04, 0.46]
    );

    const core = part(
        new THREE.SphereGeometry(0.19, 32, 24),
        glow,
        [0, 0.04, 0.58]
    );
    const coreHalo = part(
        new THREE.TorusGeometry(0.3, 0.018, 16, 64),
        trim,
        [0, 0.04, 0.58]
    );

    // hips
    part(
        new RoundedBoxGeometry(1.02, 0.28, 0.78, 3, 0.12),
        shellDeep,
        [0, -0.92, 0]
    );

    // neck
    part(new THREE.CylinderGeometry(0.15, 0.17, 0.2, 24), shellDeep, [
        0, 0.96, 0,
    ]);

    // head
    const head = new THREE.Group();
    head.position.set(0, 1.16, 0);
    robot.add(head);

    part(
        new RoundedBoxGeometry(1.26, 0.94, 0.96, 4, 0.3),
        shell,
        [0, 0.24, 0],
        { parent: head }
    );
    part(
        new RoundedBoxGeometry(1.1, 0.1, 0.86, 3, 0.05),
        trim,
        [0, 0.68, 0],
        { parent: head }
    );
    part(
        new RoundedBoxGeometry(1.04, 0.5, 0.16, 3, 0.16),
        glass,
        [0, 0.26, 0.48],
        { parent: head }
    );

    [-0.22, 0.22].forEach((x) => {
        part(new THREE.SphereGeometry(0.072, 24, 18), glow, [x, 0.28, 0.56], {
            parent: head,
        });
    });

    // ears and antenna
    [-0.66, 0.66].forEach((x) => {
        part(
            new THREE.CylinderGeometry(0.11, 0.11, 0.14, 24),
            trim,
            [x, 0.24, 0],
            { parent: head, rotation: [0, 0, Math.PI / 2] }
        );
    });

    part(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 12), trim, [0, 0.9, 0], {
        parent: head,
    });
    const antennaTip = part(
        new THREE.SphereGeometry(0.08, 24, 18),
        glow,
        [0, 1.12, 0],
        { parent: head }
    );

    // arms
    const armPivot = {};

    [-1, 1].forEach((side) => {
        const shoulder = new THREE.Group();
        shoulder.position.set(side * 0.86, 0.52, 0);
        robot.add(shoulder);
        armPivot[side === -1 ? "left" : "right"] = shoulder;

        part(new THREE.SphereGeometry(0.25, 28, 20), shellDeep, [0, 0, 0], {
            parent: shoulder,
        });
        part(new THREE.CapsuleGeometry(0.12, 0.44, 10, 20), shell, [0, -0.42, 0], {
            parent: shoulder,
        });
        part(new THREE.CapsuleGeometry(0.105, 0.38, 10, 20), shellDeep, [0, -0.95, 0], {
            parent: shoulder,
        });
        part(new THREE.SphereGeometry(0.135, 24, 18), trim, [0, -1.28, 0], {
            parent: shoulder,
        });
    });

    // legs
    [-0.34, 0.34].forEach((x) => {
        part(new THREE.CapsuleGeometry(0.15, 0.4, 10, 20), shell, [x, -1.24, 0]);
        part(new THREE.CapsuleGeometry(0.135, 0.34, 10, 20), shellDeep, [x, -1.62, 0]);
        part(
            new RoundedBoxGeometry(0.4, 0.2, 0.56, 3, 0.09),
            shellDeep,
            [x, -1.94, 0.1]
        );
    });

    // orbiting rings around the torso
    const ringOne = part(
        new THREE.TorusGeometry(1.16, 0.012, 12, 120),
        trim,
        [0, 0.1, 0],
        { rotation: [Math.PI / 2, 0, 0], castShadow: false }
    );
    const ringTwo = part(
        new THREE.TorusGeometry(1.38, 0.008, 12, 120),
        trim,
        [0, -0.1, 0],
        { rotation: [Math.PI / 2 - 0.24, 0, 0.2], castShadow: false }
    );

    // platform
    const platform = new THREE.Group();
    platform.position.y = -2.12;
    scene.add(platform);

    part(
        new THREE.CylinderGeometry(1.5, 1.62, 0.12, 64),
        floorMaterial,
        [0, 0, 0],
        { parent: platform, castShadow: false }
    );
    part(
        new THREE.TorusGeometry(1.5, 0.016, 12, 120),
        trim,
        [0, 0.07, 0],
        { parent: platform, rotation: [Math.PI / 2, 0, 0], castShadow: false }
    );
    part(
        new THREE.TorusGeometry(1.14, 0.01, 12, 120),
        trim,
        [0, 0.08, 0],
        { parent: platform, rotation: [Math.PI / 2, 0, 0], castShadow: false }
    );

    // contact shadow catcher
    const shadowCatcher = new THREE.Mesh(
        new THREE.CircleGeometry(1.75, 48),
        new THREE.ShadowMaterial({ color: 0x05030f, opacity: 0.5 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = -2.19;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    // drifting sparks
    const sparkCount = 70;
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkSeeds = [];

    for (let index = 0; index < sparkCount; index += 1) {
        const radius = 1.5 + Math.random() * 1.9;
        const angle = Math.random() * Math.PI * 2;
        const height = (Math.random() - 0.35) * 3.6;

        sparkSeeds.push({ radius, angle, height, speed: 0.1 + Math.random() * 0.25 });
        sparkPositions[index * 3] = Math.cos(angle) * radius;
        sparkPositions[index * 3 + 1] = height;
        sparkPositions[index * 3 + 2] = Math.sin(angle) * radius;
    }

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(sparkPositions, 3)
    );

    const sparks = new THREE.Points(
        sparkGeometry,
        new THREE.PointsMaterial({
            color: 0xd8b4fe,
            size: 0.045,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        })
    );
    scene.add(sparks);

    // ---------- framing ----------

    // Fit the whole subject (robot plus its platform) into the stage whatever
    // the aspect ratio, instead of guessing a camera distance.
    const subjectBox = new THREE.Box3();
    subjectBox.expandByObject(robot);
    subjectBox.expandByObject(platform);

    const subjectSphere = subjectBox.getBoundingSphere(new THREE.Sphere());
    const subjectCentre = subjectSphere.center.clone();

    let baseDistance = 5.2;

    function fitCamera() {
        const verticalFov = THREE.MathUtils.degToRad(camera.fov);
        const horizontalFov =
            2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const limitingFov = Math.min(verticalFov, horizontalFov);

        baseDistance =
            (subjectSphere.radius / Math.sin(limitingFov / 2)) * 1.08;

        camera.position.z = baseDistance;
        camera.position.x = 0;
        camera.position.y = subjectCentre.y + subjectSphere.radius * 0.12;
        camera.updateProjectionMatrix();
    }

    // ---------- pointer parallax ----------

    const pointer = { x: 0, y: 0 };
    const targetPointer = { x: 0, y: 0 };

    stage.addEventListener("pointermove", (event) => {
        const bounds = stage.getBoundingClientRect();
        targetPointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        targetPointer.y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    });

    stage.addEventListener("pointerleave", () => {
        targetPointer.x = 0;
        targetPointer.y = 0;
    });

    // ---------- sizing ----------

    function resize() {
        const bounds = stage.getBoundingClientRect();
        const width = Math.max(bounds.width, 1);
        const height = Math.max(bounds.height, 1);

        renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, width < 520 ? 1.75 : 2)
        );
        renderer.setSize(width, height, false);

        camera.aspect = width / height;
        fitCamera();
    }

    resize();

    if ("ResizeObserver" in window) {
        new ResizeObserver(resize).observe(stage);
    } else {
        window.addEventListener("resize", resize);
    }

    // ---------- animation ----------

    const clock = new THREE.Clock();
    let visible = true;
    let frame = 0;

    if ("IntersectionObserver" in window) {
        new IntersectionObserver(
            (entries) => {
                visible = entries[0].isIntersecting;
            },
            { threshold: 0.02 }
        ).observe(stage);
    }

    function damp(current, target, lambda, delta) {
        return current + (target - current) * (1 - Math.exp(-lambda * delta));
    }

    function render() {
        frame = requestAnimationFrame(render);

        const delta = Math.min(clock.getDelta(), 0.05);
        const time = clock.elapsedTime;

        if (!visible || document.hidden) {
            return;
        }

        pointer.x = damp(pointer.x, targetPointer.x, 4, delta);
        pointer.y = damp(pointer.y, targetPointer.y, 4, delta);

        robot.position.y = 0.08 + Math.sin(time * 1.05) * 0.07;
        robot.rotation.y = Math.sin(time * 0.32) * 0.16 + pointer.x * 0.28;

        head.rotation.y = damp(head.rotation.y, pointer.x * 0.42, 3.4, delta);
        head.rotation.x = damp(head.rotation.x, pointer.y * 0.22, 3.4, delta);

        // A slow wave that happens every few seconds, not a constant jiggle.
        const waveCycle = (time % 9.5) / 9.5;
        const wave = waveCycle > 0.55 && waveCycle < 0.78
            ? Math.sin((waveCycle - 0.55) * Math.PI * 6.2) *
              Math.sin((waveCycle - 0.55) / 0.23 * Math.PI)
            : 0;

        armPivot.right.rotation.z = -0.1 + wave * -0.95;
        armPivot.right.rotation.x = wave * 0.18;
        armPivot.left.rotation.z = 0.1 + Math.sin(time * 1.05) * 0.04;

        const pulse = 1.9 + Math.sin(time * 2.3) * 0.7;
        glow.emissiveIntensity = pulse;
        coreHalo.scale.setScalar(1 + Math.sin(time * 2.3) * 0.06);
        antennaTip.scale.setScalar(1 + Math.sin(time * 3.1) * 0.12);

        ringOne.rotation.z = time * 0.22;
        ringTwo.rotation.z = -time * 0.16;

        const positions = sparks.geometry.attributes.position;

        for (let index = 0; index < sparkCount; index += 1) {
            const seed = sparkSeeds[index];
            const angle = seed.angle + time * seed.speed;
            const bob = Math.sin(time * 0.6 + index) * 0.12;

            positions.array[index * 3] = Math.cos(angle) * seed.radius;
            positions.array[index * 3 + 1] = seed.height + bob;
            positions.array[index * 3 + 2] = Math.sin(angle) * seed.radius;
        }

        positions.needsUpdate = true;

        camera.position.z = baseDistance;
        camera.position.x = pointer.x * 0.2;
        camera.position.y =
            subjectCentre.y +
            subjectSphere.radius * 0.12 +
            Math.sin(time * 0.42) * 0.045 +
            pointer.y * -0.1;
        camera.lookAt(0, subjectCentre.y, 0);

        renderer.render(scene, camera);

        if (!stage.classList.contains("has-3d")) {
            stage.classList.add("has-3d");
        }
    }

    // Handy for automated layout checks: open the page with ?debug=1 to expose
    // the scene so the robot's projected bounds can be measured.
    if (new URLSearchParams(location.search).has("debug")) {
        window.__vic = { THREE, camera, robot, renderer, scene };
    }

    render();

    canvas.addEventListener("webglcontextlost", () => {
        stage.classList.remove("has-3d");
    });
}

buildRobot();
