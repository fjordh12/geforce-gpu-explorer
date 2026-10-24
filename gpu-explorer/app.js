/* ==========================================================================
   GeForce GPU Explorer
   - Procedural 3D viewer (Three.js) driven by dataset specifications
   - Analytics (Chart.js): scatter, ranking, radar comparison
   - Searchable / sortable catalog
   ========================================================================== */
(() => {
    'use strict';

    const dataset = window.NVIDIA_DATASET || [];
    if (!dataset.length) {
        console.error('NVIDIA dataset not found (dataset.js).');
        return;
    }

    /* ------------------------------ Helpers ------------------------------ */
    const $ = (id) => document.getElementById(id);
    const num = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    const usd = (n) => '$' + Math.round(n).toLocaleString('en-US');
    const usd1 = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const shortName = (g) => g.name.replace('GeForce ', '');
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const hasListings = (g) => g.priceSource === 'listings';

    const MAX = {
        tflops: Math.max(...dataset.map((d) => d.tflops)),
        bandwidth: Math.max(...dataset.map((d) => d.bandwidth)),
        perfPerWatt: Math.max(...dataset.map((d) => d.perfPerWatt)),
        vram: Math.max(...dataset.map((d) => d.vram)),
        cuda: Math.max(...dataset.map((d) => d.cuda)),
        boostClock: Math.max(...dataset.map((d) => d.boostClock))
    };
    const MIN_PRICE_PER_TFLOPS = Math.min(...dataset.map((d) => d.pricePerTflops));

    /* ------------------------------- State ------------------------------- */
    let activeGpu = dataset.find((g) => g.id === 'rtx-4080') || dataset[0];
    let compareGpu = dataset.find((g) => g.id === 'rtx-3080') || dataset[1];
    let activePart = 'overview';
    let filteredData = [...dataset];
    let sortKey = 'year';
    let sortAsc = false;

    /* One accent (NVIDIA green) + neutrals. Newer generations are greener. */
    const SERIES_TONES = {
        'RTX 50': '#bff230',
        'RTX 40': '#76b900',
        'RTX 30': '#4d7a00',
        'RTX 20': '#c9c9c9',
        'GTX 16': '#909090',
        'GTX 10': '#5e5e5e',
        'Titan / Pro': '#ffffff'
    };

    /* ============================ 3D ENGINE ============================ */
    const VIEWS = {
        iso: { pos: [5.0, 2.4, 6.4] },
        front: { pos: [0.0, 0.25, 8.4] },
        top: { pos: [0.0, 8.2, 1.4] },
        back: { pos: [0.0, 0.25, -8.4] },
        exploded: { pos: [8.0, 2.6, 4.2] },
        cooler: { pos: [2.4, 1.3, 7.6] },
        power: { pos: [3.2, 5.4, 4.6] }
    };
    const PART_VIEW = { overview: 'iso', die: 'exploded', vram: 'exploded', cooling: 'cooler', power: 'power' };

    let scene, camera, renderer, controls, raycaster, clock;
    let gpuGroup = null;
    let layers = { back: null, pcb: null, heat: null, shroud: null };
    let fans = [];
    let pins = [];
    let buildTextures = [];
    let isCustomModel = false;
    let flight = null;
    let autoRotate = false; // off by default: the model stays still until the user asks
    let isExploded = false;
    let showPins = true;
    let explodeCurrent = 0;
    let heroVisible = true;
    let threeReady = false;

    /* Shared, matte-metal material set (single accent: the LED). */
    let MAT = null;
    function createMaterials() {
        const std = (color, metalness, roughness, extra = {}) =>
            new THREE.MeshStandardMaterial(Object.assign({ color, metalness, roughness }, extra));
        MAT = {
            shroud: std(0x0e0e0e, 0.6, 0.52, { envMapIntensity: 0.5 }),
            trim: std(0x202020, 0.75, 0.4, { envMapIntensity: 0.7 }),
            backplate: std(0x141414, 0.8, 0.46, { envMapIntensity: 0.55 }),
            pcb: std(0x0c0e0b, 0.2, 0.62, { envMapIntensity: 0.4 }),
            substrate: std(0x16200f, 0.3, 0.55, { envMapIntensity: 0.4 }),
            die: std(0x8d8d8d, 0.92, 0.3, { envMapIntensity: 0.8 }),
            vram: std(0x101010, 0.5, 0.5, { envMapIntensity: 0.5 }),
            fin: std(0x686b6e, 0.9, 0.5, { envMapIntensity: 0.55 }),
            pipe: std(0x86583b, 0.85, 0.38, { envMapIntensity: 0.7 }),
            gold: std(0xa38d4b, 0.9, 0.34, { envMapIntensity: 0.7 }),
            io: std(0xb4b7ba, 0.95, 0.4, { envMapIntensity: 0.8 }),
            port: std(0x050505, 0.2, 0.7, { envMapIntensity: 0.3 }),
            fanBlade: std(0x0b0b0b, 0.35, 0.55, { side: THREE.DoubleSide, envMapIntensity: 0.45 }),
            fanHub: std(0x171717, 0.8, 0.35, { envMapIntensity: 0.6 }),
            well: new THREE.MeshBasicMaterial({ color: 0x030303 }),
            led: new THREE.MeshBasicMaterial({ color: 0x76b900, toneMapped: false })
        };
    }

    function showFallback(msg) {
        const el = $('stageFallback');
        el.textContent = msg;
        el.hidden = false;
    }

    function initThree() {
        if (!window.THREE || !THREE.OrbitControls) {
            showFallback('The 3D viewer could not load (check your internet connection). All data and charts remain available.');
            return false;
        }
        const wrapper = $('canvasWrapper');
        const canvas = $('gpuCanvas');

        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        } catch (err) {
            showFallback('WebGL is not available in this browser, so the 3D viewer is disabled. All data and charts remain available.');
            return false;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
        camera.position.set(...VIEWS.iso.pos);
        clock = new THREE.Clock();

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.07;
        controls.rotateSpeed = 0.85;
        controls.enablePan = false; // panning loses the model; presets + reset cover it
        controls.minDistance = 3.2;
        controls.maxDistance = 16;
        controls.autoRotateSpeed = 1.6;
        controls.enableZoom = false; // scroll only zooms after the user clicks the model (keeps page scrolling smooth)
        controls.addEventListener('start', () => { flight = null; });

        createMaterials();
        buildEnvironment();
        buildStage();

        scene.add(new THREE.AmbientLight(0xffffff, 0.18));
        const key = new THREE.DirectionalLight(0xffffff, 0.9);
        key.position.set(5, 8, 6);
        scene.add(key);
        const rim = new THREE.PointLight(0x76b900, 0.55, 22);
        rim.position.set(-6, 2, -5);
        scene.add(rim);

        raycaster = new THREE.Raycaster();

        /* Click (not drag) on a pin selects that component */
        let downPos = null;
        canvas.addEventListener('pointerdown', (e) => {
            downPos = { x: e.clientX, y: e.clientY };
            controls.enableZoom = true;
        });
        canvas.addEventListener('pointerup', (e) => {
            if (!downPos) return;
            const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
            downPos = null;
            if (moved < 5) pickPin(e);
        });
        canvas.addEventListener('pointerleave', () => { controls.enableZoom = false; });

        const onResize = () => {
            const w = wrapper.clientWidth;
            const h = wrapper.clientHeight;
            if (w < 2 || h < 2) return;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            /* On wide screens, shift the model to the right of the text column */
            if (w > 900) camera.setViewOffset(w, h, -w * 0.15, 0, w, h);
            else camera.clearViewOffset();
            camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', onResize);
        if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrapper);
        onResize();

        /* Pause rendering when the hero is off-screen */
        if (window.IntersectionObserver) {
            new IntersectionObserver((entries) => { heroVisible = entries[0].isIntersecting; }, { threshold: 0 })
                .observe($('explorer'));
        }

        threeReady = true;
        animate();
        return true;
    }

    /* Soft studio reflections so matte metal reads as metal (no external HDRI needed) */
    function buildEnvironment() {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new THREE.Scene();
        envScene.background = new THREE.Color(0x040404);
        const softbox = (w, h, x, y, z, v) => {
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v), side: THREE.DoubleSide })
            );
            m.position.set(x, y, z);
            m.lookAt(0, 0, 0);
            envScene.add(m);
        };
        softbox(14, 5, 0, 9, 1, 3.2);
        softbox(6, 7, -9, 2, 5, 1.8);
        softbox(6, 7, 9, 1, -5, 1.4);
        softbox(16, 3, 0, -7, 7, 0.5);
        const rt = pmrem.fromScene(envScene, 0.035);
        scene.environment = rt.texture;
        pmrem.dispose();
    }

    /* Floor glow + turntable ring (stays put when the model changes) */
    function buildStage() {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, 'rgba(118,185,0,0.34)');
        g.addColorStop(0.45, 'rgba(118,185,0,0.08)');
        g.addColorStop(1, 'rgba(118,185,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 256, 256);
        const tex = new THREE.CanvasTexture(c);
        tex.encoding = THREE.sRGBEncoding;
        const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(11, 11),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -1.25;
        scene.add(glow);

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(3.55, 3.57, 128),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -1.24;
        scene.add(ring);
    }

    /* Rounded, bevelled slab: far less "toy block" than BoxGeometry */
    function roundedBox(w, h, d, r = 0.08, b = 0.022) {
        const x = -(w - 2 * b) / 2, y = -(h - 2 * b) / 2, ww = w - 2 * b, hh = h - 2 * b;
        const rr = Math.max(0.001, r - b);
        const s = new THREE.Shape();
        s.moveTo(x + rr, y);
        s.lineTo(x + ww - rr, y);
        s.quadraticCurveTo(x + ww, y, x + ww, y + rr);
        s.lineTo(x + ww, y + hh - rr);
        s.quadraticCurveTo(x + ww, y + hh, x + ww - rr, y + hh);
        s.lineTo(x + rr, y + hh);
        s.quadraticCurveTo(x, y + hh, x, y + hh - rr);
        s.lineTo(x, y + rr);
        s.quadraticCurveTo(x, y, x + rr, y);
        const depth = Math.max(0.001, d - 2 * b);
        const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 10 });
        geo.translate(0, 0, -depth / 2);
        return geo;
    }

    function addMesh(parent, geo, mat, x = 0, y = 0, z = 0) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        parent.add(m);
        return m;
    }

    function makeNameplate(gpu) {
        const c = document.createElement('canvas');
        c.width = 1024;
        c.height = 160;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#76b900';
        ctx.fillRect(0, 0, 8, c.height);
        let size = 76;
        const label = gpu.name.toUpperCase();
        ctx.font = `800 ${size}px Barlow, Arial, sans-serif`;
        while (ctx.measureText(label).width > 700 && size > 36) {
            size -= 4;
            ctx.font = `800 ${size}px Barlow, Arial, sans-serif`;
        }
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 44, c.height / 2 + 3);
        ctx.font = '600 34px Barlow, Arial, sans-serif';
        ctx.fillStyle = '#808080';
        ctx.textAlign = 'right';
        ctx.fillText(gpu.chip, c.width - 36, c.height / 2 + 3);
        const tex = new THREE.CanvasTexture(c);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = 4;
        buildTextures.push(tex);
        return tex;
    }

    function makePinTexture() {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const ctx = c.getContext('2d');
        ctx.beginPath();
        ctx.arc(64, 64, 50, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(64, 64, 22, 0, Math.PI * 2);
        ctx.fillStyle = '#76b900';
        ctx.fill();
        const tex = new THREE.CanvasTexture(c);
        tex.encoding = THREE.sRGBEncoding;
        buildTextures.push(tex);
        return tex;
    }

    function disposeObject(obj, withMaterials) {
        obj.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (withMaterials && o.material) {
                (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
                    ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((k) => m[k] && m[k].dispose());
                    m.dispose();
                });
            }
        });
    }

    function clearModel() {
        if (gpuGroup) {
            scene.remove(gpuGroup);
            disposeObject(gpuGroup, isCustomModel);
        }
        buildTextures.forEach((t) => t.dispose());
        buildTextures = [];
        gpuGroup = null;
        fans = [];
        pins = [];
        layers = { back: null, pcb: null, heat: null, shroud: null };
    }

    /* Build the card from dataset specs: length -> body length, slots -> thickness,
       bus width -> memory chip count, CUDA cores -> die size, fans -> cooler layout. */
    function buildGPU(gpu) {
        if (!threeReady) return;
        clearModel();
        isCustomModel = false;

        gpuGroup = new THREE.Group();
        layers.back = new THREE.Group();
        layers.pcb = new THREE.Group();
        layers.heat = new THREE.Group();
        layers.shroud = new THREE.Group();

        const L = clamp((gpu.length / 300) * 4.2, 2.5, 4.9);
        const H = 1.7;
        const T = clamp(gpu.slots * 0.24, 0.42, 0.9);

        /* Backplate */
        addMesh(layers.back, roundedBox(L, H, 0.06, 0.07, 0.02), MAT.backplate, 0, 0, -T / 2 + 0.03);
        addMesh(layers.back, new THREE.BoxGeometry(L * 0.3, H * 0.5, 0.012), MAT.port, L * 0.22, 0, -T / 2 - 0.004);

        /* PCB + silicon */
        const pcbZ = -T * 0.28;
        addMesh(layers.pcb, new THREE.BoxGeometry(L * 0.84, H * 0.9, 0.04), MAT.pcb, -L * 0.04, 0, pcbZ);

        const dieSize = clamp(Math.sqrt(gpu.cuda / 20000) * 0.62, 0.3, 0.62);
        const dieX = -L * 0.14;
        addMesh(layers.pcb, new THREE.BoxGeometry(dieSize * 1.5, dieSize * 1.5, 0.03), MAT.substrate, dieX, 0, pcbZ + 0.035);
        addMesh(layers.pcb, new THREE.BoxGeometry(dieSize, dieSize, 0.05), MAT.die, dieX, 0, pcbZ + 0.06);

        const vramCount = clamp(Math.ceil(gpu.bus / 32), 4, 12);
        const vramGeo = new THREE.BoxGeometry(0.14, 0.18, 0.035);
        for (let i = 0; i < vramCount; i++) {
            const a = (i / vramCount) * Math.PI * 2;
            const r = dieSize * 1.05;
            addMesh(layers.pcb, vramGeo, MAT.vram, dieX + Math.cos(a) * r, Math.sin(a) * r * 0.85, pcbZ + 0.04);
        }
        addMesh(layers.pcb, new THREE.BoxGeometry(1.15, 0.16, 0.045), MAT.gold, -L * 0.2, -H * 0.45 - 0.06, pcbZ);
        addMesh(layers.pcb, new THREE.BoxGeometry(0.42, 0.2, 0.22), MAT.pcb, L * 0.2, H * 0.45 + 0.08, -T * 0.1);

        /* Heatsink */
        const finCount = 34;
        const finGeo = new THREE.BoxGeometry(0.022, H * 0.84, T * 0.62);
        for (let i = 0; i < finCount; i++) {
            addMesh(layers.heat, finGeo, MAT.fin, -L * 0.45 + (i / (finCount - 1)) * L * 0.9, 0, T * 0.04);
        }
        const pipeGeo = new THREE.CylinderGeometry(0.032, 0.032, L * 0.92, 14);
        pipeGeo.rotateZ(Math.PI / 2);
        [-0.4, -0.13, 0.13, 0.4].forEach((y) => addMesh(layers.heat, pipeGeo, MAT.pipe, 0, y, -T * 0.08));

        /* Shroud, LED accent, nameplate, I/O bracket */
        const faceZ = T * 0.5;
        addMesh(layers.shroud, roundedBox(L, H, T * 0.44, 0.09, 0.028), MAT.shroud, 0, 0, T * 0.28);
        addMesh(layers.shroud, new THREE.BoxGeometry(L * 0.9, 0.026, 0.012), MAT.led, 0, H * 0.43, faceZ + 0.002);
        addMesh(layers.shroud, new THREE.BoxGeometry(L * 0.9, 0.012, 0.012), MAT.trim, 0, -H * 0.43, faceZ + 0.002);

        const plateH = T * 0.4;
        const plate = addMesh(
            layers.shroud,
            new THREE.PlaneGeometry(plateH * 6.4, plateH),
            new THREE.MeshBasicMaterial({ map: makeNameplate(gpu), toneMapped: false }),
            -L * 0.06, H / 2 + 0.004, T * 0.29
        );
        plate.rotation.x = -Math.PI / 2;

        const io = addMesh(layers.shroud, new THREE.BoxGeometry(0.05, H * 1.14, T * 0.95), MAT.io, -L / 2 - 0.03, -0.05, 0);
        [-0.1, 0.1, 0.3].forEach((z) => addMesh(layers.shroud, new THREE.BoxGeometry(0.052, 0.07, 0.15), MAT.port, io.position.x - 0.002, -0.05 + 0.15, z * (T / 0.8)));

        /* Fans */
        const nFans = gpu.fans || 2;
        const fanR = Math.min(0.66, (L * 0.86) / (nFans * 2.08));
        const fanXs = [];
        for (let f = 0; f < nFans; f++) {
            const x = nFans === 1 ? 0 : -L * 0.43 + fanR + (f * (L * 0.86 - fanR * 2)) / (nFans - 1);
            fanXs.push(x);
            addMesh(layers.shroud, new THREE.CircleGeometry(fanR * 0.97, 48), MAT.well, x, 0, faceZ + 0.001);
            addMesh(layers.shroud, new THREE.RingGeometry(fanR * 0.97, fanR * 1.04, 64), MAT.trim, x, 0, faceZ + 0.003);

            const rotor = new THREE.Group();
            rotor.position.set(x, 0, faceZ + 0.02);
            const hub = new THREE.CylinderGeometry(fanR * 0.3, fanR * 0.3, 0.04, 32);
            hub.rotateX(Math.PI / 2);
            addMesh(rotor, hub, MAT.fanHub);
            const bladeShape = new THREE.Shape();
            bladeShape.absellipse(fanR * 0.6, 0, fanR * 0.36, fanR * 0.13, 0, Math.PI * 2, false, 0);
            const bladeGeo = new THREE.ShapeGeometry(bladeShape, 20);
            const blades = 11;
            for (let b = 0; b < blades; b++) {
                const pivot = new THREE.Group();
                pivot.rotation.z = (b / blades) * Math.PI * 2;
                const blade = addMesh(pivot, bladeGeo, MAT.fanBlade);
                blade.rotation.x = 0.55;
                rotor.add(pivot);
            }
            layers.shroud.add(rotor);
            fans.push(rotor);
        }

        /* Spec pins (click to inspect a component) */
        const pinTex = makePinTexture();
        const pinDefs = [
            { part: 'die', parent: layers.pcb, pos: [dieX, 0, pcbZ + 0.13] },
            { part: 'vram', parent: layers.pcb, pos: [dieX + dieSize * 0.95, dieSize * 0.78, pcbZ + 0.1] },
            { part: 'cooling', parent: layers.shroud, pos: [fanXs[fanXs.length - 1], 0, faceZ + 0.1] },
            { part: 'power', parent: layers.pcb, pos: [L * 0.2, H * 0.45 + 0.32, -T * 0.1] }
        ];
        pinDefs.forEach((d) => {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTex, depthTest: false, transparent: true }));
            s.position.set(...d.pos);
            s.scale.set(0.26, 0.26, 1);
            s.renderOrder = 10;
            s.userData = { part: d.part };
            s.visible = showPins;
            d.parent.add(s);
            pins.push(s);
        });

        gpuGroup.add(layers.back, layers.pcb, layers.heat, layers.shroud);
        scene.add(gpuGroup);
        applyLayerOffsets(explodeCurrent);
    }

    function applyLayerOffsets(f) {
        if (!layers.back) return;
        layers.back.position.z = -1.5 * f;
        layers.pcb.position.z = -0.55 * f;
        layers.heat.position.z = 0.45 * f;
        layers.shroud.position.z = 1.5 * f;
        const fade = [MAT.shroud, MAT.trim, MAT.fanBlade, MAT.fanHub];
        fade.forEach((m) => {
            m.transparent = f > 0.01;
            m.opacity = 1 - 0.58 * f;
            m.depthWrite = f < 0.35;
        });
    }

    function pickPin(e) {
        if (!showPins || !pins.length) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObjects(pins, false)[0];
        if (hit) setActivePart(hit.object.userData.part);
    }

    function flyTo(view) {
        if (!threeReady) return;
        const v = VIEWS[view] || VIEWS.iso;
        flight = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(0, 0, 0) };
        setAutoRotate(false);
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!heroVisible || document.hidden) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.elapsedTime;

        if (flight) {
            const k = 1 - Math.pow(0.0006, dt);
            camera.position.lerp(flight.pos, k);
            controls.target.lerp(flight.target, k);
            if (camera.position.distanceTo(flight.pos) < 0.02) flight = null;
        }

        const target = isExploded ? 1 : 0;
        if (Math.abs(target - explodeCurrent) > 0.0005) {
            explodeCurrent += (target - explodeCurrent) * Math.min(1, dt * 6);
            applyLayerOffsets(explodeCurrent);
        }

        if (autoRotate) {
            const spin = dt * (4 + (activeGpu.tdp || 150) / 90);
            fans.forEach((f) => { f.rotation.z -= spin; });
        }

        pins.forEach((p) => {
            const active = p.userData.part === activePart;
            const base = active ? 0.38 : 0.26;
            const s = base + Math.sin(t * 3 + (active ? 0 : 1.7)) * 0.018;
            p.scale.set(s, s, 1);
        });

        controls.autoRotate = autoRotate;
        controls.update();
        renderer.render(scene, camera);
    }

    /* Custom Blender model (.glb / .gltf) */
    function loadCustomModel(file) {
        if (!file || !threeReady || !THREE.GLTFLoader) return;
        const url = URL.createObjectURL(file);
        new THREE.GLTFLoader().load(
            url,
            (gltf) => {
                clearModel();
                isCustomModel = true;
                gpuGroup = new THREE.Group();
                const model = gltf.scene;
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                model.position.sub(center);
                model.scale.setScalar(4.2 / (Math.max(size.x, size.y, size.z) || 1));
                gpuGroup.add(model);
                scene.add(gpuGroup);
                $('viewerHint').textContent = `Custom model: ${file.name} · pick any GPU to return to the procedural model`;
                URL.revokeObjectURL(url);
            },
            undefined,
            (err) => {
                URL.revokeObjectURL(url);
                alert('Could not load the model: ' + (err && err.message ? err.message : 'unknown error'));
            }
        );
    }

    /* =========================== UI: SELECTION =========================== */
    function partCopy(g, part) {
        switch (part) {
            case 'die':
                return { title: `GPU die · ${g.chip}`, desc: `${num(g.cuda)} CUDA cores, ${g.tmu} texture units and ${g.rop} ROPs on the ${g.arch} architecture. A ${num(g.boostClock)} MHz boost clock delivers ${g.tflops} TFLOPS of FP32 compute.` };
            case 'vram':
                return { title: `Memory · ${g.vram} GB ${g.memType}`, desc: `A ${g.bus}-bit interface moves ${num(g.bandwidth)} GB/s. At the current price that works out to ${usd1(g.pricePerVram)} per gigabyte.` };
            case 'cooling':
                return { title: `Cooling · ${g.fans}-fan reference design`, desc: `${g.length} mm long and ${g.slots} slots wide. Fan count, slot width and length drive the 3D model's proportions.` };
            case 'power':
                return { title: `Power · ${g.tdp} W`, desc: `${g.perfPerWatt} TFLOPS per watt of board power. Connects through a PCIe x16 slot.` };
            default:
                return { title: 'Overview', desc: 'A procedural model scaled from this GPU\u2019s dataset specifications. Pick a component, or click a pin on the card, to inspect it.' };
        }
    }

    function setAutoRotate(on) {
        autoRotate = on;
        const b = $('btnAutoRotate');
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    }

    function setExploded(on) {
        isExploded = on;
        const b = $('btnExplodeView');
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    }

    function setActivePart(part, fly = true) {
        activePart = part;
        document.querySelectorAll('.part-item').forEach((b) => b.classList.toggle('active', b.dataset.part === part));
        const copy = partCopy(activeGpu, part);
        $('hotspotTitle').textContent = copy.title;
        $('hotspotDesc').textContent = copy.desc;
        document.querySelectorAll('.spec-row[data-part]').forEach((r) => r.classList.toggle('highlighted', r.dataset.part === part));
        setExploded(part === 'die' || part === 'vram');
        if (fly) flyTo(PART_VIEW[part] || 'iso');
    }

    function selectGpu(id, scrollToHero = false) {
        const g = dataset.find((x) => x.id === id);
        if (!g) return;
        activeGpu = g;
        $('viewerHint').textContent = 'Drag to rotate · click the model, then scroll to zoom';
        $('gpuQuickSelect').value = g.id;
        buildGPU(g);
        renderHero(g);
        renderSpecs(g);
        setActivePart(activePart, false);
        refreshCharts();
        highlightActiveRow();
        try { history.replaceState(null, '', `?gpu=${g.id}`); } catch (err) { /* not allowed in some contexts */ }
        if (scrollToHero) $('explorer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function stepGpu(dir) {
        const i = dataset.findIndex((g) => g.id === activeGpu.id);
        selectGpu(dataset[(i + dir + dataset.length) % dataset.length].id);
    }

    /* ============================ UI: RENDERING ============================ */
    function seriesLabel(g) {
        return g.series === 'Titan / Pro' ? 'Titan & Workstation' : `GeForce ${g.series} Series`;
    }

    function renderHero(g) {
        $('heroEyebrow').textContent = `${seriesLabel(g)} · ${g.arch}`;
        $('activeGpuName').textContent = g.name;
        $('heroSub').textContent = `${g.vram} GB ${g.memType} · ${num(g.cuda)} CUDA cores · ${g.tdp} W`;
        $('specPrice').textContent = usd(g.marketPrice);
        $('priceNote').textContent = hasListings(g)
            ? `Average retail · ${g.aibCount} listings · launch MSRP ${usd(g.msrp)}`
            : `Reference price · launch MSRP ${usd(g.msrp)}`;

        $('ribCuda').textContent = num(g.cuda);
        $('ribVram').innerHTML = `${g.vram}<small>GB</small>`;
        $('ribBoost').innerHTML = `${num(g.boostClock)}<small>MHz</small>`;
        $('ribTflops').innerHTML = `${g.tflops}<small>TFLOPS</small>`;
        $('ribTdp').innerHTML = `${g.tdp}<small>W</small>`;
    }

    function specGroups(g) {
        return [
            { title: 'Graphics engine', part: 'die', rows: [
                ['Architecture', g.arch], ['GPU chip', g.chip], ['Release year', g.year],
                ['CUDA cores', num(g.cuda)], ['Texture units / ROPs', `${g.tmu} / ${g.rop}`],
                ['Base clock', `${num(g.baseClock)} MHz`], ['Boost clock', `${num(g.boostClock)} MHz`],
                ['FP32 compute', `${g.tflops} TFLOPS`]
            ] },
            { title: 'Memory', part: 'vram', rows: [
                ['Memory size', `${g.vram} GB`], ['Memory type', g.memType],
                ['Memory interface', `${g.bus}-bit`], ['Memory bandwidth', `${num(g.bandwidth)} GB/s`]
            ] },
            { title: 'Power', part: 'power', rows: [
                ['Board power (TDP)', `${g.tdp} W`], ['Efficiency', `${g.perfPerWatt} TFLOPS/W`], ['System interface', 'PCIe x16']
            ] },
            { title: 'Physical', part: 'cooling', rows: [
                ['Card length', `${g.length} mm`], ['Slot width', `${g.slots}-slot`], ['Reference cooler', `${g.fans}-fan axial`]
            ] },
            { title: 'Pricing', part: null, rows: [
                [hasListings(g) ? 'Average retail price' : 'Reference price', usd(g.marketPrice)],
                ['Launch MSRP', usd(g.msrp)],
                ['Price per TFLOPS', usd1(g.pricePerTflops)],
                ['Price per GB of memory', usd1(g.pricePerVram)]
            ] }
        ];
    }

    function renderSpecs(g) {
        $('specsTitle').textContent = g.name;
        $('specsLead').textContent = `${g.arch} architecture · ${g.chip} · released ${g.year}`;

        $('specGroups').innerHTML = specGroups(g).map((grp) => `
            <section class="spec-group">
                <h3 class="spec-group-title">${grp.title}</h3>
                <dl>${grp.rows.map((r) => `<div class="spec-row"${grp.part ? ` data-part="${grp.part}"` : ''}><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('')}</dl>
            </section>`).join('');

        $('specTflops').textContent = `${g.tflops} TFLOPS`;
        $('barTflops').style.width = `${clamp((g.tflops / MAX.tflops) * 100, 2, 100)}%`;
        $('specBandwidth').textContent = `${num(g.bandwidth)} GB/s`;
        $('barBandwidth').style.width = `${clamp((g.bandwidth / MAX.bandwidth) * 100, 2, 100)}%`;
        $('specEff').textContent = `${g.perfPerWatt} TFLOPS/W`;
        $('barEff').style.width = `${clamp((g.perfPerWatt / MAX.perfPerWatt) * 100, 2, 100)}%`;
        $('specValueScore').textContent = `${usd1(g.pricePerTflops)} / TFLOPS`;
        $('barValue').style.width = `${clamp((MIN_PRICE_PER_TFLOPS / g.pricePerTflops) * 100, 4, 100)}%`;

        const list = $('aibList');
        if (hasListings(g) && g.aibExamples.length) {
            $('specPriceRangeBadge').textContent = `${usd(g.minPrice)} – ${usd(g.maxPrice)}`;
            list.innerHTML = g.aibExamples.map((a) => `
                <div class="listing-item">
                    <div class="listing-main"><span class="listing-brand">${esc(a.brand)}</span><span class="listing-name" title="${esc(a.name)}">${esc(a.name)}</span></div>
                    <span class="listing-price">${usd(a.price)}</span>
                </div>`).join('');
        } else {
            $('specPriceRangeBadge').textContent = 'Reference price';
            list.innerHTML = `<p class="listing-empty">No retail listings for this model exist in the source dataset, so a reference price of ${usd(g.marketPrice)} is shown instead (launch MSRP ${usd(g.msrp)}).</p>`;
        }
    }

    function renderKPIs() {
        $('kpiTotalModels').textContent = dataset.length;
        const bestVal = [...dataset].sort((a, b) => a.pricePerTflops - b.pricePerTflops)[0];
        $('kpiBestValue').textContent = shortName(bestVal);
        $('kpiBestValueSub').textContent = `${usd1(bestVal.pricePerTflops)} per TFLOPS at ${usd(bestVal.marketPrice)}`;
        const bestEff = [...dataset].sort((a, b) => b.perfPerWatt - a.perfPerWatt)[0];
        $('kpiBestEff').textContent = shortName(bestEff);
        $('kpiBestEffSub').textContent = `${bestEff.perfPerWatt} TFLOPS per watt at ${bestEff.tdp} W`;
        const prices = dataset.map((d) => d.marketPrice);
        $('kpiAvgPrice').textContent = usd(prices.reduce((a, b) => a + b, 0) / prices.length);
        $('kpiPriceRange').textContent = `Ranging from ${usd(Math.min(...prices))} to ${usd(Math.max(...prices))}`;
    }

    /* =============================== CHARTS =============================== */
    let scatterChart = null, rankingChart = null, radarChart = null;

    function initCharts() {
        if (!window.Chart) return;
        Chart.defaults.color = '#808080';
        Chart.defaults.font.family = "'Barlow', sans-serif";
        Chart.defaults.font.size = 12;
        Chart.defaults.animation.duration = 500;
        const tip = Chart.defaults.plugins.tooltip;
        tip.backgroundColor = '#000';
        tip.borderColor = 'rgba(255,255,255,0.2)';
        tip.borderWidth = 1;
        tip.padding = 12;
        tip.cornerRadius = 2;
        tip.titleFont = { weight: '700', size: 13 };
        tip.bodyColor = '#b8b8b8';
        tip.displayColors = false;
        renderScatter();
        renderRanking();
        renderRadar();
    }

    function refreshCharts() {
        if (!window.Chart) return;
        if (scatterChart) scatterChart.update('none');
        renderRanking();
        renderRadar();
    }

    const isActive = (raw) => raw && raw.gpu && raw.gpu.id === activeGpu.id;

    function renderScatter() {
        const groups = {};
        dataset.forEach((g) => {
            (groups[g.series] = groups[g.series] || []).push({ x: g.marketPrice, y: g.tflops, gpu: g });
        });
        const datasets = Object.keys(SERIES_TONES).filter((s) => groups[s]).map((s) => ({
            label: s,
            data: groups[s],
            backgroundColor: SERIES_TONES[s],
            pointStyle: 'circle',
            pointRadius: (c) => (isActive(c.raw) ? 9 : 5),
            pointHoverRadius: 8,
            pointBorderColor: (c) => (isActive(c.raw) ? '#ffffff' : 'rgba(0,0,0,0.7)'),
            pointBorderWidth: (c) => (isActive(c.raw) ? 2.5 : 1)
        }));
        if (scatterChart) scatterChart.destroy();
        scatterChart = new Chart($('scatterChart'), {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (evt, els) => {
                    if (els.length) selectGpu(datasets[els[0].datasetIndex].data[els[0].index].gpu.id, true);
                },
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, boxHeight: 7, padding: 18, color: '#b8b8b8' } },
                    tooltip: {
                        callbacks: {
                            title: (items) => items[0].raw.gpu.name,
                            label: (c) => `${usd(c.raw.gpu.marketPrice)} · ${c.raw.gpu.tflops} TFLOPS · ${c.raw.gpu.vram} GB`
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'logarithmic', min: 50, max: 8000,
                        title: { display: true, text: 'Price (USD, log scale)', color: '#808080' },
                        grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false },
                        ticks: { callback: (v) => ([100, 200, 500, 1000, 2000, 5000].includes(v) ? usd(v) : '') }
                    },
                    y: {
                        title: { display: true, text: 'FP32 compute (TFLOPS)', color: '#808080' },
                        grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false }, beginAtZero: true
                    }
                }
            }
        });
    }

    const valueLabels = {
        id: 'valueLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            ctx.save();
            ctx.fillStyle = '#b8b8b8';
            ctx.font = "600 11px 'Barlow', sans-serif";
            ctx.textBaseline = 'middle';
            chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(chart.data.datasets[0].data[i], bar.x + 8, bar.y));
            ctx.restore();
        }
    };

    function renderRanking() {
        const metric = $('rankingMetricSelect').value;
        const top = [...dataset].sort((a, b) => (metric === 'pricePerTflops' ? a[metric] - b[metric] : b[metric] - a[metric])).slice(0, 12);
        if (rankingChart) rankingChart.destroy();
        rankingChart = new Chart($('rankingChart'), {
            type: 'bar',
            plugins: [valueLabels],
            data: {
                labels: top.map(shortName),
                datasets: [{
                    data: top.map((g) => g[metric]),
                    backgroundColor: top.map((g, i) => (g.id === activeGpu.id || i === 0 ? '#76b900' : '#333333')),
                    hoverBackgroundColor: '#bff230',
                    borderRadius: 1,
                    barPercentage: 0.72
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { right: 48 } },
                onClick: (evt, els) => { if (els.length) selectGpu(top[els[0].index].id, true); },
                onHover: (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { title: (items) => top[items[0].dataIndex].name, label: (c) => `${c.raw} · ${usd(top[c.dataIndex].marketPrice)}` } }
                },
                scales: {
                    x: { grid: { color: 'rgba(255,255,255,0.06)' }, border: { display: false } },
                    y: { grid: { display: false }, border: { display: false }, ticks: { color: '#b8b8b8' } }
                }
            }
        });
    }

    function renderRadar() {
        if (!window.Chart) return;
        $('compareLabelA').textContent = shortName(activeGpu);
        const norm = (g) => [
            (g.tflops / MAX.tflops), (g.vram / MAX.vram), (g.bandwidth / MAX.bandwidth),
            (g.cuda / MAX.cuda), (g.perfPerWatt / MAX.perfPerWatt), (g.boostClock / MAX.boostClock)
        ].map((v) => Math.round(v * 100));

        if (radarChart) radarChart.destroy();
        radarChart = new Chart($('radarChart'), {
            type: 'radar',
            data: {
                labels: ['FP32 compute', 'Memory size', 'Bandwidth', 'CUDA cores', 'Efficiency', 'Boost clock'],
                datasets: [
                    { label: shortName(activeGpu), data: norm(activeGpu), borderColor: '#76b900', backgroundColor: 'rgba(118,185,0,0.18)', pointBackgroundColor: '#76b900', borderWidth: 2, pointRadius: 3 },
                    { label: shortName(compareGpu), data: norm(compareGpu), borderColor: '#c9c9c9', backgroundColor: 'rgba(255,255,255,0.06)', pointBackgroundColor: '#c9c9c9', borderWidth: 2, pointRadius: 3 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, boxHeight: 7, padding: 18, color: '#b8b8b8' } } },
                scales: {
                    r: {
                        min: 0, max: 100, ticks: { display: false, stepSize: 25 },
                        grid: { color: 'rgba(255,255,255,0.08)' }, angleLines: { color: 'rgba(255,255,255,0.08)' },
                        pointLabels: { color: '#b8b8b8', font: { size: 12, weight: '600' } }
                    }
                }
            }
        });

        const A = activeGpu, B = compareGpu;
        const rows = [
            ['Price', usd(A.marketPrice), usd(B.marketPrice), A.marketPrice, B.marketPrice, true],
            ['FP32 compute', `${A.tflops} TFLOPS`, `${B.tflops} TFLOPS`, A.tflops, B.tflops, false],
            ['CUDA cores', num(A.cuda), num(B.cuda), A.cuda, B.cuda, false],
            ['Memory', `${A.vram} GB ${A.memType}`, `${B.vram} GB ${B.memType}`, A.vram, B.vram, false],
            ['Bandwidth', `${num(A.bandwidth)} GB/s`, `${num(B.bandwidth)} GB/s`, A.bandwidth, B.bandwidth, false],
            ['Board power', `${A.tdp} W`, `${B.tdp} W`, A.tdp, B.tdp, true],
            ['Price per TFLOPS', usd1(A.pricePerTflops), usd1(B.pricePerTflops), A.pricePerTflops, B.pricePerTflops, true]
        ];
        $('compareDiffTable').innerHTML = `
            <table>
                <thead><tr><th>Specification</th><th class="col-a">${esc(shortName(A))}</th><th class="col-b">${esc(shortName(B))}</th></tr></thead>
                <tbody>${rows.map(([label, fa, fb, a, b, lowerBetter]) => {
                    const pct = b ? Math.round(((a - b) / b) * 100) : 0;
                    const good = lowerBetter ? pct < 0 : pct > 0;
                    const delta = pct === 0 ? '' : `<span class="delta ${good ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct}%</span>`;
                    return `<tr><td>${label}</td><td class="col-a">${esc(fa)}${delta}</td><td class="col-b">${esc(fb)}</td></tr>`;
                }).join('')}</tbody>
            </table>`;
    }

    /* =============================== CATALOG =============================== */
    function applyFilters() {
        const q = $('searchInput').value.trim().toLowerCase();
        const series = $('seriesFilter').value;
        const minVram = Number($('vramFilter').value);

        filteredData = dataset.filter((g) => {
            if (series !== 'ALL' && g.series !== series) return false;
            if (g.vram < minVram) return false;
            return !q || `${g.name} ${g.chip} ${g.arch} ${g.memType} ${g.series}`.toLowerCase().includes(q);
        });
        filteredData.sort((a, b) => {
            const x = a[sortKey], y = b[sortKey];
            if (typeof x === 'string') return sortAsc ? x.localeCompare(y) : y.localeCompare(x);
            return sortAsc ? x - y : y - x;
        });

        document.querySelectorAll('.table thead th').forEach((th) => {
            const on = th.dataset.sort === sortKey;
            th.classList.toggle('sorted', on);
            th.classList.toggle('asc', on && sortAsc);
        });
        $('resultCount').textContent = `${filteredData.length} of ${dataset.length} GPUs`;
        renderTable();
    }

    function renderTable() {
        const body = $('gpuTableBody');
        if (!filteredData.length) {
            body.innerHTML = '<tr><td colspan="9" class="table-empty">No GPUs match these filters.</td></tr>';
            return;
        }
        body.innerHTML = filteredData.map((g) => `
            <tr data-id="${g.id}" class="${g.id === activeGpu.id ? 'active-row' : ''}">
                <td class="gpu-name">${esc(g.name)}<small>${esc(g.series)} · ${esc(g.arch)}</small></td>
                <td>${g.year}</td>
                <td class="num">${g.vram} GB ${esc(g.memType)}</td>
                <td class="num">${num(g.cuda)}</td>
                <td class="num">${num(g.boostClock)} MHz</td>
                <td class="num">${g.tflops}</td>
                <td class="num">${g.tdp} W</td>
                <td class="num">${usd(g.marketPrice)}${hasListings(g) ? '' : '*'}</td>
                <td class="num">${usd1(g.pricePerTflops)}</td>
            </tr>`).join('');
    }

    function highlightActiveRow() {
        $('gpuTableBody').querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('active-row', tr.dataset.id === activeGpu.id));
    }

    /* =============================== EVENTS =============================== */
    function bindEvents() {
        const quick = $('gpuQuickSelect');
        const cmp = $('compareGpuSelect');
        const options = dataset.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
        quick.innerHTML = options;
        cmp.innerHTML = options;
        quick.value = activeGpu.id;
        cmp.value = compareGpu.id;

        quick.addEventListener('change', (e) => selectGpu(e.target.value));
        $('btnPrevGpu').addEventListener('click', () => stepGpu(-1));
        $('btnNextGpu').addEventListener('click', () => stepGpu(1));
        cmp.addEventListener('change', (e) => {
            compareGpu = dataset.find((g) => g.id === e.target.value) || compareGpu;
            renderRadar();
        });
        $('rankingMetricSelect').addEventListener('change', renderRanking);

        document.querySelectorAll('.part-item').forEach((b) => b.addEventListener('click', () => setActivePart(b.dataset.part)));

        $('btnAutoRotate').addEventListener('click', () => { flight = null; setAutoRotate(!autoRotate); });
        $('btnExplodeView').addEventListener('click', () => {
            setExploded(!isExploded);
            if (isExploded) flyTo('exploded');
        });
        $('btnTogglePins').addEventListener('click', () => {
            showPins = !showPins;
            $('btnTogglePins').classList.toggle('active', showPins);
            $('btnTogglePins').setAttribute('aria-pressed', String(showPins));
            pins.forEach((p) => { p.visible = showPins; });
        });
        document.querySelectorAll('.tool[data-view]').forEach((b) => b.addEventListener('click', () => flyTo(b.dataset.view)));
        $('btnResetCam').addEventListener('click', () => { setExploded(false); setActivePart('overview', false); flyTo('iso'); });

        $('glbUploadInput').addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) loadCustomModel(e.target.files[0]);
            e.target.value = '';
        });

        ['input', 'change'].forEach((ev) => {
            $('searchInput').addEventListener(ev, applyFilters);
            $('seriesFilter').addEventListener(ev, applyFilters);
            $('vramFilter').addEventListener(ev, applyFilters);
        });
        document.querySelectorAll('.table thead th[data-sort]').forEach((th) => th.addEventListener('click', () => {
            const k = th.dataset.sort;
            if (sortKey === k) sortAsc = !sortAsc;
            else { sortKey = k; sortAsc = k === 'name'; }
            applyFilters();
        }));
        $('gpuTableBody').addEventListener('click', (e) => {
            const tr = e.target.closest('tr[data-id]');
            if (tr) selectGpu(tr.dataset.id, true);
        });

        /* Highlight the nav link of the section in view */
        if (window.IntersectionObserver) {
            const links = [...document.querySelectorAll('.nav-links a')];
            const io = new IntersectionObserver((entries) => {
                entries.forEach((en) => {
                    if (en.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
                });
            }, { rootMargin: '-45% 0px -50% 0px' });
            ['explorer', 'specs', 'analytics', 'catalog'].forEach((id) => $(id) && io.observe($(id)));
        }
    }

    /* ================================ INIT ================================ */
    function init() {
        /* Deep links: ?gpu=rtx-5090&part=die */
        const params = new URLSearchParams(window.location.search);
        const linked = dataset.find((g) => g.id === params.get('gpu'));
        if (linked) activeGpu = linked;
        if (activeGpu.id === compareGpu.id) compareGpu = dataset.find((g) => g.id !== activeGpu.id);

        bindEvents();
        renderKPIs();
        renderHero(activeGpu);
        renderSpecs(activeGpu);
        initThree();
        buildGPU(activeGpu);
        const linkedPart = params.get('part');
        setActivePart(PART_VIEW[linkedPart] ? linkedPart : 'overview', Boolean(PART_VIEW[linkedPart]));
        initCharts();
        applyFilters();

        /* Rebuild once web fonts are ready so the 3D nameplate uses Barlow */
        if (document.fonts && document.fonts.load) {
            document.fonts.load('800 40px Barlow').then(() => buildGPU(activeGpu)).catch(() => {});
        }
    }

    init();
})();
