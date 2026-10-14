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
import { useMusicPlayer } from '../audio/MusicPlayer'

const SCOPE_RADIUS = 0.9
const SCOPE_DEPTH = 2
const TRACE_COUNT = 1024
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
}: {
  spine?: SpinePath
}) {
  const { vectorscopeAnalysers, playing } = useMusicPlayer()
  const data = useMemo(
    () => vectorscopeAnalysers
      ? [new Uint8Array(vectorscopeAnalysers[0].fftSize), new Uint8Array(vectorscopeAnalysers[1].fftSize)] as const
      : null,
    [vectorscopeAnalysers],
  )
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
    if (!playing || !vectorscopeAnalysers || !data) return
    vectorscopeAnalysers[0].getByteTimeDomainData(data[0])
    vectorscopeAnalysers[1].getByteTimeDomainData(data[1])
    const positions = trace.geometry.getAttribute('position') as BufferAttribute
    const sampleCount = Math.min(positions.count, data[0].length, data[1].length)
    const start = Math.min(data[0].length, data[1].length) - sampleCount
    for (let i = 0; i < positions.count; i++) {
      const t = i / (positions.count - 1)
      const sample = start + Math.floor(t * (sampleCount - 1))
      const left = (data[0][sample] - 128) / 128
      const right = (data[1][sample] - 128) / 128
      const mid = (left + right) * 0.5 * SCOPE_RADIUS
      const side = (left - right) * 0.5 * SCOPE_RADIUS
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
    <group>
      <primitive object={timeAxis} />
      <group visible={playing && Boolean(vectorscopeAnalysers)}>
        <primitive object={traceLine} />
        <primitive object={trace} />
      </group>
    </group>
  )
}
