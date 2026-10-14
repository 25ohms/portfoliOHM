import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Line,
  LineBasicMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from 'three'

export const SCOPE_RADIUS = 0.9
const SCOPE_DEPTH = 2
export const TRACE_COUNT = 1024
const CAGE_STEPS = 48
export type SpinePath = Vector3[] | null

function makeTimeAxis(curve: CatmullRomCurve3 | null): Line {
  const geometry = new BufferGeometry()
  if (curve) geometry.setFromPoints(curve.getSpacedPoints(CAGE_STEPS))
  else geometry.setFromPoints([new Vector3(0, -SCOPE_DEPTH / 2, 0), new Vector3(0, SCOPE_DEPTH / 2, 0)])
  return new Line(geometry, new LineBasicMaterial({
    color: 0xffa45e, transparent: true, opacity: 0.95,
    depthWrite: false, blending: AdditiveBlending,
  }))
}

export default function Vectorscope({
  spine,
  samples,
  visible,
}: {
  spine?: SpinePath
  samples: { current: Float32Array }
  visible: boolean
}) {
  const curve = useMemo(
    () => spine && spine.length > 1 ? new CatmullRomCurve3(spine, false, 'centripetal') : null,
    [spine],
  )
  const { trace, traceMaterial, traceLine, traceLineMaterial, timeAxis, timeAxisMaterial } = useMemo(() => {
    const traceGeometry = new BufferGeometry()
    traceGeometry.setAttribute('position', new BufferAttribute(new Float32Array(TRACE_COUNT * 3), 3))
    const trace = new Points(traceGeometry, new PointsMaterial({
      color: 0xc9ffff, size: 0.024, transparent: true, opacity: 1,
      depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true,
    }))
    const traceLineMaterial = new LineBasicMaterial({
      color: 0x9bffff, transparent: true, opacity: 0.9,
      depthWrite: false, blending: AdditiveBlending,
    })
    const traceLine = new Line(traceGeometry, traceLineMaterial)
    const timeAxis = makeTimeAxis(curve)
    return {
      trace,
      traceMaterial: trace.material,
      traceLine,
      traceLineMaterial,
      timeAxis,
      timeAxisMaterial: timeAxis.material as LineBasicMaterial,
    }
  }, [curve])
  const transportedFrames = useMemo(
    () => curve?.computeFrenetFrames(TRACE_COUNT - 1, false) ?? null,
    [curve],
  )

  useFrame(() => {
    const positions = trace.geometry.getAttribute('position') as BufferAttribute
    const sampleCount = Math.min(positions.count, samples.current.length / 2)
    for (let i = 0; i < positions.count; i++) {
      const t = i / (positions.count - 1)
      const samplePosition = t * (sampleCount - 1)
      const sampleIndex = Math.floor(samplePosition)
      const sampleBlend = samplePosition - sampleIndex
      const sampleStart = sampleIndex * 2
      const sampleEnd = Math.min(sampleCount - 1, sampleIndex + 1) * 2
      const mid = samples.current[sampleStart] * (1 - sampleBlend) + samples.current[sampleEnd] * sampleBlend
      const side = samples.current[sampleStart + 1] * (1 - sampleBlend) + samples.current[sampleEnd + 1] * sampleBlend
      if (curve && transportedFrames) {
        const center = curve.getPointAt(t)
        center.addScaledVector(transportedFrames.normals[i], mid)
        center.addScaledVector(transportedFrames.binormals[i], side)
        positions.setXYZ(i, center.x, center.y, center.z)
      } else positions.setXYZ(i, mid, (t - 0.5) * SCOPE_DEPTH, side)
    }
    positions.needsUpdate = true
    trace.geometry.computeBoundingSphere()
  })

  useEffect(() => () => {
    trace.geometry.dispose()
    traceMaterial.dispose()
    traceLineMaterial.dispose()
    timeAxis.geometry.dispose()
    timeAxisMaterial.dispose()
  }, [trace, traceMaterial, traceLineMaterial, timeAxis, timeAxisMaterial])

  return (
    <group visible={visible}>
      <primitive object={timeAxis} />
      <primitive object={traceLine} />
      <primitive object={trace} />
    </group>
  )
}
