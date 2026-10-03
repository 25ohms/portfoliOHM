import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  DataTexture,
  LinearFilter,
  SRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three'
import type { SceneConfig } from '../config/scene'
import { paletteBytes } from './math'

const fragmentShader = `
  uniform sampler2D tScene;
  uniform sampler2D tPalette;
  uniform vec2 uResolution;
  uniform float uPixelSize;
  uniform float uStrength;
  uniform float uLevels;
  uniform int uMatrix;
  uniform bool uEnabled;
  varying vec2 vUv;
  float bayer(vec2 p) {
    float value = 0.0;
    for (int i = 0; i < 3; i++) {
      if ((i == 1 && uMatrix < 4) || (i == 2 && uMatrix < 8)) break;
      vec2 bits = mod(floor(p / exp2(float(i))), 2.0);
      value = value * 4.0 + mod(bits.x + bits.y, 2.0) * 2.0 + bits.y;
    }
    return (value + 0.5) / float(uMatrix * uMatrix);
  }
  void main() {
    vec2 pixel = floor(vUv * uResolution / uPixelSize);
    vec2 uv = uEnabled ? (pixel + 0.5) * uPixelSize / uResolution : vUv;
    vec3 source = texture2D(tScene, uv).rgb;
    float intensity = clamp(dot(source, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    if (uEnabled) {
      intensity = floor(intensity * (uLevels - 1.0) + mix(0.5, bayer(pixel), uStrength)) / (uLevels - 1.0);
    }
    gl_FragColor = vec4(texture2D(tPalette, vec2((intensity * 255.0 + 0.5) / 256.0, 0.5)).rgb, 1.0);
    #include <colorspace_fragment>
  }
`

export default function PalettePass({
  config,
  resolution,
}: {
  config: SceneConfig
  resolution: number
}) {
  const { gl, size, invalidate } = useThree()
  const resources = useMemo(() => {
    const target = new WebGLRenderTarget(1, 1, { depthBuffer: true })
    const palette = new DataTexture(new Uint8Array(256 * 4), 256, 1, RGBAFormat)
    palette.colorSpace = SRGBColorSpace
    palette.minFilter = LinearFilter
    palette.magFilter = LinearFilter
    const material = new ShaderMaterial({
      uniforms: {
        tScene: { value: target.texture },
        tPalette: { value: palette },
        uResolution: { value: new Vector2() },
        uPixelSize: { value: 2 },
        uStrength: { value: 1 },
        uLevels: { value: 5 },
        uMatrix: { value: 4 },
        uEnabled: { value: true },
      },
      vertexShader:
        'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const geometry = new PlaneGeometry(2, 2)
    const screen = new Scene()
    screen.add(new Mesh(geometry, material))
    return {
      target,
      palette,
      material,
      geometry,
      screen,
      camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
    }
  }, [])

  useEffect(() => {
    resources.palette.image.data.set(paletteBytes(config.palette))
    resources.palette.needsUpdate = true
    const u = resources.material.uniforms
    u.uPixelSize.value = config.dither.pixelSize
    u.uStrength.value = config.dither.strength
    u.uLevels.value = config.dither.levels
    u.uMatrix.value = config.dither.matrix
    u.uEnabled.value = config.dither.enabled
    invalidate()
  }, [config.dither, config.palette, resources, invalidate])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    resources.target.setSize(
      Math.max(1, Math.floor(size.width * dpr * resolution)),
      Math.max(1, Math.floor(size.height * dpr * resolution)),
    )
    resources.material.uniforms.uResolution.value.set(size.width, size.height)
    invalidate()
  }, [gl, size, resolution, config.quality.maxDpr, resources, invalidate])

  useEffect(
    () => () => {
      resources.target.dispose()
      resources.palette.dispose()
      resources.geometry.dispose()
      resources.material.dispose()
    },
    [resources],
  )

  useFrame(({ scene, camera }) => {
    gl.setRenderTarget(resources.target)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.render(resources.screen, resources.camera)
  }, 1)
  return null
}
