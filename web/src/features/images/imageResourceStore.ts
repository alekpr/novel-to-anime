type AccessMode = 'read' | 'readwrite'

type LocalHandle<T> = T & {
  queryPermission(options: { mode: AccessMode }): Promise<PermissionState>
  requestPermission(options: { mode: AccessMode }): Promise<PermissionState>
}

export type ImageWorkspace = {
  folder: LocalHandle<FileSystemDirectoryHandle>
  references: Record<string, LocalHandle<FileSystemFileHandle>>
  workspaceId?: string
  footageNames?: Record<string, string>
}

export type ImageResource = { name: string } & (
  { status: 'ready'; file: File } | { status: 'missing' | 'permission' | 'unavailable' }
)

export type ImageWorkspaceStatus = {
  workspace: ImageWorkspace | undefined
  images: FileSystemDirectoryHandle | undefined
  folderStatus: 'none' | 'ready' | 'missing' | 'permission' | 'unavailable'
  footagesStatus: 'none' | 'ready' | 'missing' | 'permission' | 'unavailable'
  references: Record<string, ImageResource>
}

type LocalPickers = Window & {
  showDirectoryPicker?: (options: { mode: AccessMode; id: string }) => Promise<ImageWorkspace['folder']>
  showOpenFilePicker?: (options: {
    id: string
    startIn: FileSystemDirectoryHandle
    excludeAcceptAllOption: boolean
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<LocalHandle<FileSystemFileHandle>[]>
}

const storeName = 'workspaces'
const pickers = window as LocalPickers
export const supportsImageFolders = !!(pickers.showDirectoryPicker && pickers.showOpenFilePicker)

function openStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('novel-image-resources', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, setResult: (result: T) => void) => void,
) {
  const database = await openStore()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode)
      let result: T
      transaction.oncomplete = () => resolve(result)
      transaction.onabort = () => reject(transaction.error)
      operation(transaction.objectStore(storeName), value => { result = value })
    })
  } finally {
    database.close()
  }
}

export function getWorkspace(projectId: string) {
  return withStore<ImageWorkspace | undefined>('readonly', (store, finish) => {
    const request = store.get(projectId)
    request.onsuccess = () => finish(request.result)
  })
}

export function updateWorkspace(projectId: string, change: (stored?: ImageWorkspace) => ImageWorkspace | undefined) {
  return withStore<void>('readwrite', store => {
    const request = store.get(projectId)
    request.onsuccess = () => {
      const workspace = change(request.result)
      if (workspace) store.put(workspace, projectId)
    }
  })
}

export function deleteImageWorkspace(projectId: string) {
  return withStore<void>('readwrite', store => { store.delete(projectId) })
}

function accessStatus(error: unknown): 'missing' | 'permission' | 'unavailable' {
  if (error instanceof DOMException) {
    if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') return 'missing'
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'permission'
  }
  return 'unavailable'
}

async function inspectFolder(folder: ImageWorkspace['folder']): Promise<Pick<ImageWorkspaceStatus, 'folderStatus' | 'images'>> {
  try {
    if (await folder.queryPermission({ mode: 'read' }) !== 'granted') return { folderStatus: 'permission', images: undefined }
    return { folderStatus: 'ready', images: await folder.getDirectoryHandle('Images') }
  } catch (error) {
    return { folderStatus: accessStatus(error), images: undefined }
  }
}

export async function inspectImageWorkspace(projectId: string, keys: readonly string[]): Promise<ImageWorkspaceStatus> {
  const workspace = await getWorkspace(projectId)
  if (!workspace) return { workspace, images: undefined, folderStatus: 'none', footagesStatus: 'none', references: {} }

  const [folder, footagesStatus, references] = await Promise.all([
    inspectFolder(workspace.folder),
    inspectFootages(workspace.folder),
    Promise.all(keys.flatMap(key => {
      const handle = workspace.references[key]
      if (!handle) return []
      return (async (): Promise<[string, ImageResource]> => {
        try {
          return [key, { status: 'ready', name: handle.name, file: await handle.getFile() }]
        } catch (error) {
          return [key, { status: accessStatus(error), name: handle.name }]
        }
      })()
    })),
  ])
  return { workspace, ...folder, footagesStatus, references: Object.fromEntries(references) }
}

async function inspectFootages(folder: ImageWorkspace['folder']): Promise<ImageWorkspaceStatus['footagesStatus']> {
  try {
    if (await folder.queryPermission({ mode: 'readwrite' }) !== 'granted') return 'permission'
    await folder.getDirectoryHandle('Footages', { create: true })
    return 'ready'
  } catch (error) {
    return accessStatus(error)
  }
}

export async function chooseImageWorkspace(projectId: string, newFolderName?: string) {
  const parent = await pickers.showDirectoryPicker!({ id: 'project-image-workspace', mode: 'readwrite' })
  const folder = newFolderName
    ? await parent.getDirectoryHandle(newFolderName, { create: true }) as ImageWorkspace['folder']
    : parent
  await folder.getDirectoryHandle('Images', { create: true })
  await folder.getDirectoryHandle('Footages', { create: true })
  const saved = await getWorkspace(projectId)
  const sameFolder = saved ? await saved.folder.isSameEntry(folder) : false
  await updateWorkspace(projectId, stored => ({
    folder, references: stored?.references ?? {}, workspaceId: sameFolder && stored?.workspaceId ? stored.workspaceId : crypto.randomUUID(),
    ...(sameFolder && { footageNames: stored?.footageNames }),
  }))
}

export async function chooseImageReference(projectId: string, key: string, images: FileSystemDirectoryHandle) {
  const [handle] = await pickers.showOpenFilePicker!({
    id: 'project-reference-image',
    startIn: images,
    excludeAcceptAllOption: true,
    types: [{ description: 'ไฟล์ภาพ', accept: {
      'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'],
      'image/avif': ['.avif'], 'image/gif': ['.gif'], 'image/bmp': ['.bmp'],
    } }],
  })
  if (!handle) return
  await handle.getFile()
  await updateWorkspace(projectId, stored => stored && ({
    ...stored, references: { ...stored.references, [key]: handle },
  }))
}

export function unlinkImageReference(projectId: string, key: string) {
  return updateWorkspace(projectId, stored => {
    if (!stored) return
    const references = { ...stored.references }
    delete references[key]
    return { ...stored, references }
  })
}

export async function grantImageAccess(handle: ImageWorkspace['folder'] | ImageWorkspace['references'][string], mode: AccessMode) {
  if (await handle.requestPermission({ mode }) !== 'granted') {
    throw new DOMException('File access declined', 'NotAllowedError')
  }
}
