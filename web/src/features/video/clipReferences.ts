import type { Clip } from '../../lib/api'
import { characterImageKey, locationImageKey, outfitImageKeys, propImageKey } from '../../../../src/utils/imageReferenceKeys'
import { MAX_REFERENCE_AUDIOS, supportedReferenceImage } from '../../../../src/utils/videoClipInputs'
import { inspectImageWorkspace } from '../images/imageResourceStore'
import type { EpisodeImageResources } from '../images/useImageResources'

type ReferenceResources = Pick<EpisodeImageResources, 'chars' | 'locs' | 'props'>

export function clipImageSlots(clip: Clip, resources: ReferenceResources) {
  const names = new Map<string, string[]>()
  function add(role: string, name: string, key: string) {
    const label = JSON.stringify([role, name])
    names.set(label, [...(names.get(label) ?? []), key])
  }
  for (const char of resources.chars) {
    const outfits = char.outfits ?? []
    if (!outfits.length) add('character', char.name, characterImageKey(char._id))
    const keys = outfitImageKeys(char)
    outfits.forEach((outfit, i) => add('character', outfit.name ? `${char.name} · ${outfit.name}` : char.name, keys[i]))
  }
  for (const loc of resources.locs) add('location', loc.name, locationImageKey(loc._id))
  for (const prop of resources.props) add('prop', prop.name, propImageKey(prop._id))

  return (clip.referenceSlots ?? []).slice().sort((a, b) => a.index - b.index).map(slot => {
    const matches = names.get(JSON.stringify([slot.role, slot.name]))
    return { ...slot, key: slot.resourceKey ?? (matches?.length === 1 ? matches[0] : undefined) }
  })
}

export function clipAudioSlots(clip: Clip, resources: ReferenceResources) {
  const characters = new Map(resources.chars.map(char => [char._id, char]))
  const speakerIds = clip.speakerCharacterIds ?? legacySpeakerIds(clip, resources)
  const speakers = [...new Set(speakerIds)].flatMap(id => {
    const char = characters.get(id)
    return char ? [char] : []
  })
  const available = speakers.flatMap(char => char.voice?.audioReference
    ? [{ charId: char._id, name: char.name, audioRef: char.voice.audioReference }]
    : [])
  return {
    attached: available.slice(0, MAX_REFERENCE_AUDIOS),
    overLimit: available.slice(MAX_REFERENCE_AUDIOS),
    missing: speakers.filter(char => !char.voice?.audioReference),
  }
}

// Existing H3 clips bind the speaker's Subject number to the same Picture number.
function legacySpeakerIds(clip: Clip, resources: ReferenceResources) {
  const characterIdsByKey = new Map(resources.chars.flatMap(char =>
    [characterImageKey(char._id), ...outfitImageKeys(char)].map(key => [key, char._id] as const),
  ))
  const characterIdsBySubject = new Map(clipImageSlots(clip, resources).flatMap(slot => {
    const id = slot.role === 'character' && slot.key ? characterIdsByKey.get(slot.key) : undefined
    return id ? [[slot.index, id] as const] : []
  }))
  return Array.from(clip.videoPrompt.matchAll(/<Subject\s+(\d+)>\s*\(S\d+\)[^<>\r\n]*<d>[\s\S]*?<\/d>/gi))
    .flatMap(([, subject]) => {
      const id = characterIdsBySubject.get(Number(subject))
      return id ? [id] : []
    })
}

export async function buildSendFormData(
  clip: Clip,
  projectId: string,
  resources: ReferenceResources,
  isOptimized?: boolean
): Promise<FormData> {
  const slots = clipImageSlots(clip, resources)
  const { attached: audios } = clipAudioSlots(clip, resources)
  const keys = slots.flatMap(slot => slot.key ? [slot.key] : [])
  const current = await inspectImageWorkspace(projectId, keys)
  const body = new FormData()
  body.append('promptVersion', String(clip.promptVersion))
  if (isOptimized && clip.videoPrompt) body.append('optimizedPrompt', clip.videoPrompt)
  for (const slot of slots) {
    const ref = slot.key ? current.references[slot.key] : undefined
    if (ref?.status !== 'ready' || !supportedReferenceImage(ref.file.name, ref.file.size)) {
      throw new Error(`ตรวจไฟล์ Picture ${slot.index} · ${slot.name} ในขั้น 5 ก่อนส่ง`)
    }
    body.append(`picture-${slot.index}`, ref.file)
  }
  for (const audio of audios) {
    const res = await fetch(`/api/characters/${audio.charId}/audio-reference`)
    if (!res.ok) throw new Error(`โหลดไฟล์เสียงของ ${audio.name} ไม่สำเร็จ`)
    const blob = await res.blob()
    const ext = audio.audioRef.split('.').pop() ?? 'mp3'
    body.append(`audio-${audio.charId}`, new File([blob], `${audio.charId}.${ext}`, { type: blob.type }))
  }
  return body
}
