import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { LevaPanel, folder, useControls, useCreateStore } from 'leva'
import { DEFAULT_SCENE, parseSceneConfig, type SceneConfig, type Vec3 } from '../config/scene'

export default function SceneDevPanel({
  config,
  setConfig,
  getPose,
  onReplace,
  onPause,
  onClose,
}: {
  config: SceneConfig
  setConfig: Dispatch<SetStateAction<SceneConfig>>
  getPose: () => Vec3
  onReplace: (c: SceneConfig) => void
  onPause: () => void
  onClose: () => void
}) {
  const store = useCreateStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState(
    'Changes are saved in this browser. Export to promote a preset.',
  )
  const patch = <K extends Exclude<keyof SceneConfig, 'version' | 'palette'>>(
    section: K,
    key: keyof SceneConfig[K],
    value: unknown,
  ) => {
    setConfig((c) => ({ ...c, [section]: { ...c[section], [key]: value } }))
  }
  const scalar = <K extends Exclude<keyof SceneConfig, 'version' | 'palette'>>(
    section: K,
    key: keyof SceneConfig[K],
    min: number,
    max: number,
    step: number,
  ) => ({
    value: config[section][key] as number,
    min,
    max,
    step,
    onChange: (value: number, _path: string, context: { initial: boolean }) => {
      if (!context.initial) patch(section, key, value)
    },
  })
  function updatePaletteColor(index: number, color: string) {
    setConfig((current) => ({
      ...current,
      palette: current.palette.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, color } : stop,
      ),
    }))
  }

  function updatePalettePosition(index: number, value: number) {
    setConfig((current) => {
      // Keep the stop between its neighbors so the color ramp stays ordered.
      const minimum = current.palette[index - 1].position + 0.001
      const maximum = current.palette[index + 1].position - 0.001
      const position = Math.max(minimum, Math.min(maximum, value))
      return {
        ...current,
        palette: current.palette.map((stop, stopIndex) =>
          stopIndex === index ? { ...stop, position } : stop,
        ),
      }
    })
  }

  function createPaletteControls() {
    const controls: Parameters<typeof folder>[0] = {}

    config.palette.forEach((stop, index) => {
      controls[`color ${index}`] = {
        value: stop.color,
        onChange: (color: string, _path: string, context: { initial: boolean }) => {
          if (!context.initial) updatePaletteColor(index, color)
        },
      }

      // Endpoint positions are fixed at 0 and 1.
      if (index === 0 || index === config.palette.length - 1) return
      controls[`stop ${index}`] = {
        value: stop.position,
        min: 0.01,
        max: 0.99,
        step: 0.01,
        onChange: (position: number, _path: string, context: { initial: boolean }) => {
          if (!context.initial) updatePalettePosition(index, position)
        },
      }
    })

    return controls
  }

  useControls(
    () => ({
      'Model / pose': folder({
        rotation: {
          value: getPose().map((v) => (v * 180) / Math.PI) as Vec3,
          step: 1,
          onChange: (value: Vec3, _path, ctx) => {
            if (!ctx.initial) {
              onPause()
              patch(
                'model',
                'rotation',
                value.map((v) => (v * Math.PI) / 180),
              )
            }
          },
        },
        position: {
          value: config.model.position,
          min: -5,
          max: 5,
          step: 0.05,
          onChange: (v: Vec3, _path, ctx) => {
            if (!ctx.initial) patch('model', 'position', v)
          },
        },
        scale: scalar('model', 'scale', 0.1, 3, 0.01),
        intensity: scalar('material', 'intensity', 0, 2, 0.01),
        opacity: scalar('material', 'opacity', 0.05, 1, 0.01),
      }),
      Camera: folder(
        {
          fov: scalar('camera', 'fov', 15, 75, 1),
          padding: scalar('camera', 'padding', 1, 3, 0.01),
          speed: scalar('motion', 'speed', 0, 0.5, 0.005),
        },
        { collapsed: true },
      ),
      Dither: folder({
        enabled: {
          value: config.dither.enabled,
          onChange: (v, _path, ctx) => {
            if (!ctx.initial) patch('dither', 'enabled', v)
          },
        },
        matrix: {
          value: String(config.dither.matrix),
          options: ['2', '4', '8'],
          onChange: (v, _path, ctx) => {
            if (!ctx.initial) patch('dither', 'matrix', Number(v))
          },
        },
        pixelSize: scalar('dither', 'pixelSize', 1, 6, 0.25),
        strength: scalar('dither', 'strength', 0, 1, 0.01),
        levels: scalar('dither', 'levels', 2, 16, 1),
      }),
      Palette: folder(createPaletteControls()),
      Stars: folder(
        {
          count: scalar('stars', 'count', 0, 3000, 25),
          size: scalar('stars', 'size', 0.5, 4, 0.1),
          brightness: scalar('stars', 'brightness', 0, 1, 0.01),
          seed: scalar('stars', 'seed', 0, 65535, 1),
        },
        { collapsed: true },
      ),
      Quality: folder(
        {
          maxDpr: scalar('quality', 'maxDpr', 1, 2, 0.25),
          resolution: scalar('quality', 'resolution', 0.5, 1, 0.05),
        },
        { collapsed: true },
      ),
    }),
    { store },
  )

  const snapshot = () =>
    parseSceneConfig({ ...config, model: { ...config.model, rotation: getPose() } })
  const exportPreset = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'ohmega-scene.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage('Exported the current pose and all settings.')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  return (
    <aside className="dev-panel" aria-label="Scene development controls">
      <div className="dev-panel-heading">
        SCENE LAB <span>DEVELOPMENT ONLY</span>
        <button aria-label="Close scene tuning" onClick={onClose}>
          ×
        </button>
      </div>
      <LevaPanel store={store} fill flat titleBar={false} />
      <div className="dev-actions">
        <button
          onClick={() => {
            onReplace(snapshot())
            setMessage('Current pose captured in the rotation controls.')
          }}
        >
          Capture pose
        </button>
        <button onClick={exportPreset}>Export JSON</button>
        <button onClick={() => fileInput.current?.click()}>Import JSON</button>
        <button
          onClick={() => {
            onReplace(structuredClone(DEFAULT_SCENE))
            setMessage('Restored committed defaults.')
          }}
        >
          Reset all
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          try {
            onReplace(parseSceneConfig(JSON.parse(await file.text())))
          } catch (error) {
            setMessage((error as Error).message)
          }
          e.target.value = ''
        }}
      />
      <p role="status">{message}</p>
    </aside>
  )
}
