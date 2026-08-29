import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const canvas = document.querySelector('#life-hero-canvas')
const stage = document.querySelector('[data-testid="avatar-stage"]')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const state = {
  activeAction: null,
  activeClip: 'Idle_02',
  animationSpeed: 1,
  base: null,
  baseMeshes: [],
  jacket: null,
  loaded: false,
  loading: false,
  mixer: null,
  modelBox: null,
  root: null,
  static: stage.dataset.motionMode === 'static',
  view: 'full',
}
let renderer
let scene
let camera
let clock

function collectSkinnedMeshes(root) {
  const meshes = []
  root?.traverse?.(object => {
    if (object.isSkinnedMesh) meshes.push(object)
  })
  if (root?.isSkinnedMesh && meshes.length === 0) meshes.push(root)
  return meshes
}

function usesSameSkeleton(left, right) {
  if (!left || !right || left.bones.length !== right.bones.length) return false
  return left.bones.every((bone, index) => bone === right.bones[index])
}

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
  const rim = new THREE.DirectionalLight(0x91a8be, 0.65)
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
  const height = Math.max(size.y, 0.01)
  state.modelBox = box
  camera.near = Math.max(height / 500, 0.0001)
  camera.far = height * 20
  setView(state.view)
}

function getHandBounds(boneName) {
  const base = state.base
  if (!base?.isSkinnedMesh) return null
  const boneIndex = base.skeleton.bones.findIndex(bone => bone.name === boneName)
  const positionAttribute = base.geometry.getAttribute('position')
  const skinIndexAttribute = base.geometry.getAttribute('skinIndex')
  const skinWeightAttribute = base.geometry.getAttribute('skinWeight')
  if (boneIndex < 0 || !positionAttribute || !skinIndexAttribute || !skinWeightAttribute) return null

  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  const components = ['x', 'y', 'z', 'w']
  base.updateMatrixWorld(true)
  for (let vertex = 0; vertex < positionAttribute.count; vertex += 1) {
    let handWeight = 0
    for (let component = 0; component < 4; component += 1) {
      const joint = skinIndexAttribute[`get${components[component].toUpperCase()}`](vertex)
      if (joint === boneIndex) {
        handWeight += skinWeightAttribute[`get${components[component].toUpperCase()}`](vertex)
      }
    }
    if (handWeight < 0.35) continue
    point.fromBufferAttribute(positionAttribute, vertex)
    base.applyBoneTransform(vertex, point)
    base.localToWorld(point)
    box.expandByPoint(point)
  }
  return box.isEmpty() ? null : box
}

function setView(viewName) {
  state.view = viewName
  if (!state.root || !state.modelBox || !camera) return false
  state.root.updateMatrixWorld(true)
  const size = state.modelBox.getSize(new THREE.Vector3())
  const center = state.modelBox.getCenter(new THREE.Vector3())
  const height = Math.max(size.y, 0.01)
  const target = center.clone()
  const position = center.clone()
  camera.fov = 30

  if (viewName === 'face-front' || viewName === 'face-three-quarter') {
    const head = state.root.getObjectByName('Head')
    if (!head) return false
    head.getWorldPosition(target)
    target.y += height * 0.055
    position.copy(target)
    position.y += height * 0.015
    position.z += height * 0.62
    if (viewName === 'face-three-quarter') {
      position.x += height * 0.28
      position.z -= height * 0.04
    }
    camera.fov = 27
  } else if (viewName === 'left-hand' || viewName === 'right-hand') {
    const boneName = viewName === 'left-hand' ? 'LeftHand' : 'RightHand'
    const handBox = getHandBounds(boneName)
    if (!handBox) return false
    handBox.getCenter(target)
    const handSize = handBox.getSize(new THREE.Vector3())
    camera.fov = 27
    const handExtent = Math.max(handSize.x, handSize.y, handSize.z)
    const distance = Math.max(
      handExtent / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.35,
      height * 0.24,
    )
    position.copy(target)
    position.x += (viewName === 'left-hand' ? -1 : 1) * distance * 0.16
    position.y += distance * 0.04
    position.z += distance
  } else {
    target.y += height * 0.02
    position.set(center.x, center.y + height * 0.03, center.z + height * 2.8)
  }

  camera.position.copy(position)
  camera.lookAt(target)
  camera.updateProjectionMatrix()
  if (renderer) renderer.render(scene, camera)
  return true
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
    const baseRoot = gltf.scene.getObjectByName('LifeHero_BaseBody')
    const jacket = gltf.scene.getObjectByName('LifeHero_Jacket')
    const baseMeshes = collectSkinnedMeshes(baseRoot)
    const base = baseMeshes[0]
    if (!baseRoot || baseMeshes.length !== 4 || !jacket?.isSkinnedMesh
      || !baseMeshes.every(mesh => usesSameSkeleton(mesh.skeleton, jacket.skeleton))) {
      throw new Error('base and jacket are not separate skinned meshes on one skeleton')
    }
    const jacketMaterials = Array.isArray(jacket.material) ? jacket.material : [jacket.material]
    for (const material of jacketMaterials) {
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1
      material.needsUpdate = true
    }
    jacket.renderOrder = 1
    gltf.scene.animations = gltf.animations
    state.root = gltf.scene
    state.base = base
    state.baseMeshes = baseMeshes
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
      materials: baseMeshes.map(mesh => mesh.material.name),
      meshes: [baseRoot.name, jacket.name],
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
  setView(state.view)
  renderer.render(scene, camera)
  return true
}

window.lifeHeroViewer = {
  ensureLoaded,
  getState: () => ({
    activeClip: state.activeClip,
    jacketVisible: state.jacket?.visible ?? null,
    loaded: state.loaded,
    materialRegions: state.baseMeshes.map(mesh => mesh.material.name),
    static: state.static,
    view: state.view,
  }),
  setJacketVisible,
  setMotion,
  setSampleTime,
  setStatic,
  setView,
}
window.addEventListener('resize', resize)
new ResizeObserver(resize).observe(canvas)
renderLoop()
if (!state.static) ensureLoaded()
