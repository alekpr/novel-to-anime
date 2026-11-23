import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { EpisodeStatusResult } from '../../hooks/useEpisodeStatus'
import { charactersApi, locationsApi } from '../../lib/api'
import { characterImageKey, locationImageKey, outfitImageKeys } from '../../../../src/utils/imageReferenceKeys'
export { characterImageKey, locationImageKey, outfitImageKeys }
import {
  chooseImageReference, chooseImageWorkspace, grantImageAccess, inspectImageWorkspace,
  supportsImageFolders, unlinkImageReference,
} from './imageResourceStore'

export function useImageResources(projectId: string, bible: EpisodeStatusResult['bible'] | undefined, enabled: boolean) {
  const qc = useQueryClient()
  const operation = useRef(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ target: string; message: string } | null>(null)
  const { data: allChars, isError: charsFailed } = useQuery({
    queryKey: ['characters', projectId],
    queryFn: () => charactersApi.list(projectId),
    enabled: enabled && !!bible,
  })
  const { data: allLocs, isError: locsFailed } = useQuery({
    queryKey: ['locations', projectId],
    queryFn: () => locationsApi.list(projectId),
    enabled: enabled && !!bible,
  })

  const chars = (allChars ?? []).filter(char => bible?.characterIds.includes(char._id))
  const locs = (allLocs ?? []).filter(loc => bible?.locationIds.includes(loc._id))
  const keys = [
    ...chars.flatMap(char => char.outfits?.length ? outfitImageKeys(char) : [characterImageKey(char._id)]),
    ...locs.map(loc => locationImageKey(loc._id)),
  ].sort()
  const queryPrefix = ['image-workspace', projectId]
  const query = useQuery({
    queryKey: [...queryPrefix, keys],
    queryFn: () => inspectImageWorkspace(projectId, keys),
    enabled: enabled && supportsImageFolders,
    refetchInterval: query => query.state.data?.workspace ? 3000 : false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  })

  const data = query.data
  const workspace = data?.workspace
  const references = data?.references ?? {}
  const ready = keys.filter(key => references[key]?.status === 'ready').length
  const missing = keys.filter(key => references[key]?.status === 'missing').length
  const listsReady = !!allChars && !!allLocs && !!bible &&
    chars.length === bible.characterIds.length && locs.length === bible.locationIds.length
  const complete = listsReady && keys.length > 0 && ready === keys.length && data?.folderStatus === 'ready'

  async function run(target: string, action: () => Promise<void>) {
    if (operation.current) return false
    operation.current = true
    setBusy(target)
    setError(null)
    try {
      await action()
      return true
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      if (name !== 'AbortError') {
        setError({
          target,
          message: name === 'NotAllowedError' || name === 'SecurityError'
            ? 'เปิดไฟล์หรือโฟลเดอร์ไม่ได้ กรุณาอนุญาตให้เบราว์เซอร์เข้าถึง หรือลองเลือกใหม่'
            : 'บันทึกการเชื่อมโยงไม่สำเร็จ กรุณาตรวจไฟล์หรือโฟลเดอร์แล้วลองอีกครั้ง',
        })
      }
      return false
    } finally {
      await qc.invalidateQueries({ queryKey: queryPrefix })
      operation.current = false
      setBusy(null)
    }
  }

  return {
    chars, locs, total: keys.length, ready, missing, complete, references,
    supported: supportsImageFolders,
    isLoading: enabled && ((!!bible && ((!allChars && !charsFailed) || (!allLocs && !locsFailed))) || query.isLoading),
    loadFailed: charsFailed || locsFailed || query.isError,
    folderName: workspace?.folder.name,
    workspaceId: workspace?.workspaceId,
    folderStatus: data?.folderStatus ?? 'none',
    footagesStatus: data?.footagesStatus ?? 'none',
    canAttach: !!data?.images,
    busy, error,
    selectFolder: (name?: string) => run('folder', () => chooseImageWorkspace(projectId, name)),
    reconnectFolder: () => workspace && run('folder', () => grantImageAccess(workspace.folder, 'read')),
    restoreImagesFolder: () => workspace && run('folder', async () => {
      await grantImageAccess(workspace.folder, 'readwrite')
      await workspace.folder.getDirectoryHandle('Images', { create: true })
      await workspace.folder.getDirectoryHandle('Footages', { create: true })
    }),
    enableFootages: () => workspace && run('footages', async () => {
      await grantImageAccess(workspace.folder, 'readwrite')
      await workspace.folder.getDirectoryHandle('Footages', { create: true })
    }),
    selectImage: (key: string) => data?.images && run(key, () => chooseImageReference(projectId, key, data.images!)),
    removeImage: (key: string) => run(key, () => unlinkImageReference(projectId, key)),
    reconnectImage: (key: string) => workspace?.references[key] && run(key, () => grantImageAccess(workspace.references[key], 'read')),
  }
}

export type EpisodeImageResources = ReturnType<typeof useImageResources>
