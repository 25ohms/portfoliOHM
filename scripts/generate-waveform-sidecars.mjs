import { spawn } from 'node:child_process'

const bucket = 'portfoliohm-media'
const barCount = 128

function runWrangler(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'wrangler@4.149.0', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const errorText = Buffer.concat(stderr).toString().trim()
      if (code !== 0) {
        reject(new Error(`Wrangler failed (${code}): ${errorText || 'no error details'}`))
        return
      }
      resolve({ stdout: Buffer.concat(stdout), stderr: errorText })
    })
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

async function getObject(key) {
  const result = await runWrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--remote', '--pipe'])
  return result.stdout
}

async function putObject(key, content) {
  await runWrangler(
    [
      'r2',
      'object',
      'put',
      `${bucket}/${key}`,
      '--remote',
      '--pipe',
      '--force',
      '--content-type',
      'application/json',
      '--cache-control',
      'public, max-age=86400',
    ],
    content,
  )
}

function readWaveform(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Only RIFF/WAVE audio is supported')
  }

  let format = null
  let channels = 0
  let sampleRate = 0
  let blockAlign = 0
  let bitsPerSample = 0
  let dataOffset = -1
  let dataLength = 0

  for (let offset = 12; offset + 8 <= wav.length; ) {
    const chunkName = wav.toString('ascii', offset, offset + 4)
    const chunkLength = wav.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkStart + chunkLength > wav.length) throw new Error('WAV chunk extends beyond file')
    if (chunkName === 'fmt ') {
      if (chunkLength < 16) throw new Error('WAV format chunk is incomplete')
      format = wav.readUInt16LE(chunkStart)
      channels = wav.readUInt16LE(chunkStart + 2)
      sampleRate = wav.readUInt32LE(chunkStart + 4)
      blockAlign = wav.readUInt16LE(chunkStart + 12)
      bitsPerSample = wav.readUInt16LE(chunkStart + 14)
      if (format === 0xfffe && chunkLength >= 40) format = wav.readUInt16LE(chunkStart + 24)
    } else if (chunkName === 'data' && dataOffset < 0) {
      dataOffset = chunkStart
      dataLength = chunkLength
    }
    offset = chunkStart + chunkLength + (chunkLength % 2)
  }

  if (!channels || !sampleRate || !blockAlign || dataOffset < 0) {
    throw new Error('WAV is missing required format or audio data')
  }
  if (format !== 1 && format !== 3) throw new Error(`Unsupported WAV encoding ${format}`)
  if (format === 1 && ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new Error(`Unsupported PCM bit depth ${bitsPerSample}`)
  }
  if (format === 3 && ![32, 64].includes(bitsPerSample)) {
    throw new Error(`Unsupported float bit depth ${bitsPerSample}`)
  }

  const bytesPerSample = bitsPerSample / 8
  const frameCount = Math.floor(dataLength / blockAlign)
  const bars = new Array(barCount).fill(0)
  const valueAt = (offset) => {
    if (format === 3) {
      return bitsPerSample === 32 ? wav.readFloatLE(offset) : wav.readDoubleLE(offset)
    }
    if (bitsPerSample === 8) return (wav.readUInt8(offset) - 128) / 128
    if (bitsPerSample === 16) return wav.readInt16LE(offset) / 32768
    if (bitsPerSample === 24) {
      let value = wav.readUIntLE(offset, 3)
      if (value & 0x800000) value -= 0x1000000
      return value / 8388608
    }
    return wav.readInt32LE(offset) / 2147483648
  }

  for (let frame = 0; frame < frameCount; frame++) {
    const bar = Math.min(barCount - 1, Math.floor((frame * barCount) / frameCount))
    const frameOffset = dataOffset + frame * blockAlign
    for (let channel = 0; channel < channels; channel++) {
      const sample = valueAt(frameOffset + channel * bytesPerSample)
      if (Number.isFinite(sample)) bars[bar] = Math.max(bars[bar], Math.min(1, Math.abs(sample)))
    }
  }

  return {
    version: 1,
    algorithm: 'interval-peak-v1',
    barCount,
    sampleRate,
    durationSeconds: Number((frameCount / sampleRate).toFixed(3)),
    bars: bars.map((bar) => Number(bar.toFixed(4))),
  }
}

function parseProjects(source) {
  const lines = source.toString('utf8').split(/\r?\n/).map((line) => line.trim())
  const projects = []
  for (let index = 0; index < lines.length; index++) {
    const title = lines[index].match(/^(.+):$/)?.[1]?.trim()
    if (!title) continue
    const listing = lines.slice(index + 1).find((line) => line && !line.startsWith('#'))
    if (!listing?.endsWith('/*')) continue
    projects.push({ title, prefix: listing.slice(0, -2).replace(/^\/+|\/+$/g, '') })
    index = lines.indexOf(listing, index + 1)
  }
  return projects
}

async function main() {
  const index = await getObject('music/indexing.txt')
  const projects = parseProjects(index)
  if (!projects.length) throw new Error('No projects found in music/indexing.txt')

  let completed = 0
  for (const project of projects) {
    const tracklist = await getObject(`music/${project.prefix}/tracklist.txt`)
    const tracks = tracklist
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))

    for (const entry of tracks) {
      const title = entry.replace(/\.wav$/i, '')
      const relativeAudio = project.title === 'ohmSTEP:vol2'
        ? `${project.prefix}/${title}/${title}.wav`
        : `${project.prefix}/${title}.wav`
      const audioKey = `music/${relativeAudio}`
      const sidecarKey = audioKey.replace(/\.wav$/i, '.waveform.json')
      const waveform = readWaveform(await getObject(audioKey))
      await putObject(sidecarKey, Buffer.from(`${JSON.stringify(waveform)}\n`))
      const verified = JSON.parse((await getObject(sidecarKey)).toString('utf8'))
      if (verified.version !== 1 || verified.bars?.length !== barCount) {
        throw new Error(`Remote verification failed for ${sidecarKey}`)
      }
      completed++
      console.log(`[waveform] ${completed}: uploaded ${sidecarKey} (${barCount} bars)`)
    }
  }
  console.log(`[waveform] Complete: ${completed} sidecars generated and verified in R2.`)
}

main().catch((error) => {
  console.error(`[waveform] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
