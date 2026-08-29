import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const canvas = document.querySelector('#life-hero-canvas')
const stage = document.querySelector('[data-testid="avatar-stage"]')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const state = {
  activeAction: null,
  activeClip: 'Idle_02',
  animationSpeed: 1,
  jacket: null,
  loaded: false,
  loading: false,
  mixer: null,
  root: null,
  static: stage.dataset.motionMode === 'static',
}
let renderer
let scene
let camera
let clock

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

function initialiseRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(30, 1, 0.001, 100)
  scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x182439, 1.65))
  const key = new THREE.DirectionalLight(0xfff0d0, 2.6)
  key.position.set(3, 5, 4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x56e0d3, 1.4)
  rim.position.set(-4, 3, -3)
  scene.add(rim)
  clock = new THREE.Clock()
}

function resize() {
  if (!renderer || !camera) return
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function frameModel(root) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const height = Math.max(size.y, 0.01)
  camera.near = Math.max(height / 500, 0.0001)
  camera.far = height * 20
  camera.position.set(center.x, center.y + height * 0.03, center.z + height * 2.8)
  camera.lookAt(center.x, center.y + height * 0.02, center.z)
  camera.updateProjectionMatrix()
}

function renderLoop() {
  requestAnimationFrame(renderLoop)
  if (!renderer || !scene || !camera) return
  const delta = Math.min(clock.getDelta(), 0.05)
  if (state.mixer && !state.static) state.mixer.update(delta * state.animationSpeed)
  renderer.render(scene, camera)
}

function setJacketVisible(visible) {
  if (state.jacket) state.jacket.visible = visible
  stage.dataset.jacketVisible = String(visible)
}

function playClip(clipName, speed = 1) {
  state.activeClip = clipName
  state.animationSpeed = speed
  stage.dataset.activeClip = clipName
  if (!state.mixer || !state.root) return
  const clip = THREE.AnimationClip.findByName(state.root.animations, clipName)
  if (!clip) {
    dispatch('life-hero-viewer-fallback', { reason: `missing clip ${clipName}` })
    return
  }
  const nextAction = state.mixer.clipAction(clip)
  nextAction.reset().setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY).play()
  if (state.activeAction && state.activeAction !== nextAction) {
    state.activeAction.fadeOut(0.18)
    nextAction.fadeIn(0.18)
  }
  state.activeAction = nextAction
  state.activeAction.paused = state.static
}

async function ensureLoaded() {
  if (state.loaded || state.loading || reducedMotion.matches) return
  state.loading = true
  try {
    if (!renderer) initialiseRenderer()
    const loader = new GLTFLoader()
    const url = new URL('./assets/life-hero-modular.glb', document.baseURI).href
    const gltf = await loader.loadAsync(url)
    const base = gltf.scene.getObjectByName('LifeHero_BaseBody')
    const jacket = gltf.scene.getObjectByName('LifeHero_Jacket')
    if (!base?.isSkinnedMesh || !jacket?.isSkinnedMesh || base.skeleton !== jacket.skeleton) {
      throw new Error('base and jacket are not separate skinned meshes on one skeleton')
    }
    gltf.scene.animations = gltf.animations
    state.root = gltf.scene
    state.jacket = jacket
    state.mixer = new THREE.AnimationMixer(gltf.scene)
    scene.add(gltf.scene)
    frameModel(gltf.scene)
    resize()
    state.loaded = true
    state.loading = false
    playClip(state.activeClip, state.animationSpeed)
    dispatch('life-hero-viewer-ready', {
      animations: gltf.animations.map(clip => clip.name),
      meshes: [base.name, jacket.name],
    })
  } catch (error) {
    state.loading = false
    dispatch('life-hero-viewer-fallback', {
      reason: error instanceof Error ? error.message : '3D renderer unavailable',
    })
  }
}

function setStatic(isStatic) {
  state.static = isStatic
  if (state.activeAction) state.activeAction.paused = isStatic
  if (!isStatic) ensureLoaded()
}

function setMotion(_intent, clipName, speed) {
  playClip(clipName, speed)
}

function setSampleTime(seconds) {
  if (!state.activeAction || !state.mixer) return false
  state.activeAction.paused = true
  state.activeAction.time = Math.max(0, seconds) % state.activeAction.getClip().duration
  state.mixer.update(0)
  renderer.render(scene, camera)
  return true
}

window.lifeHeroViewer = {
  ensureLoaded,
  getState: () => ({
    activeClip: state.activeClip,
    jacketVisible: state.jacket?.visible ?? null,
    loaded: state.loaded,
    static: state.static,
  }),
  setJacketVisible,
  setMotion,
  setSampleTime,
  setStatic,
}
window.addEventListener('resize', resize)
new ResizeObserver(resize).observe(canvas)
renderLoop()
if (!state.static) ensureLoaded()
