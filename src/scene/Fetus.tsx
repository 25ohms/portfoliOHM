import { useEffect, useMemo } from 'react'
import { useLoader } from '@react-three/fiber'
import { AdditiveBlending, Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { FetusLoader } from './FetusLoader'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import modelUrl from '../../models/fetus/source/scene.fbx?url'
import type { SceneConfig } from '../config/scene'

export default function Fetus({ config, onReady }: { config: SceneConfig; onReady: () => void }) {
  const original = useLoader(FetusLoader, modelUrl)
  const { normalized, material } = useMemo(() => {
    const object = clone(original)
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      toneMapped: false,
    })
    object.traverse((child) => {
      if (child instanceof Mesh) child.material = material
    })
    object.updateMatrixWorld(true)
    const box = new Box3().setFromObject(object)
    const center = box.getCenter(new Vector3())
    const scale = 2 / Math.max(...box.getSize(new Vector3()).toArray())
    object.position.sub(center)
    const normalized = new Group()
    normalized.add(object)
    normalized.scale.setScalar(scale)
    return { normalized, material }
  }, [original])
  useEffect(() => {
    material.color.setRGB(
      config.material.intensity,
      config.material.intensity,
      config.material.intensity,
    )
    material.opacity = config.material.opacity
  }, [material, config.material])
  useEffect(() => {
    onReady()
  }, [onReady])
  // Cached FBX geometry is shared across route visits; only our material is owned here.
  useEffect(() => () => material.dispose(), [material])
  return <primitive object={normalized} dispose={null} />
}
