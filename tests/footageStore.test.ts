import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { saveEpisodeSubtitles, saveFootage } from '../web/src/features/video/footageStore';
import { getWorkspace, updateWorkspace } from '../web/src/features/images/imageResourceStore';
import type { ImageWorkspace } from '../web/src/features/images/imageResourceStore';

vi.mock('../web/src/features/images/imageResourceStore', () => ({
  getWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
}));

class MemoryDirectory {
  readonly folders = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, Blob>();

  constructor(readonly name: string) {}

  async queryPermission() { return 'granted'; }

  async getDirectoryHandle(name: string) {
    if (!this.folders.has(name)) this.folders.set(name, new MemoryDirectory(name));
    return this.folders.get(name)!;
  }

  async getFileHandle(name: string, { create = false } = {}) {
    if (!this.files.has(name) && !create) throw new DOMException(name, 'NotFoundError');
    return {
      name,
      getFile: async () => new File([this.files.get(name) ?? ''], name),
      createWritable: async () => {
        const chunks: BlobPart[] = [];
        return new WritableStream<Uint8Array<ArrayBuffer>>({
          write: chunk => { chunks.push(chunk); },
          close: () => { this.files.set(name, new Blob(chunks)); },
        });
      },
    };
  }

  async removeEntry(name: string) { this.files.delete(name); }
}

const fetchMock = vi.fn();
let folder: MemoryDirectory;
let workspace: ImageWorkspace;

beforeEach(() => {
  folder = new MemoryDirectory('Project');
  workspace = { folder: folder as unknown as ImageWorkspace['folder'], references: {}, workspaceId: 'local' };
  vi.mocked(getWorkspace).mockImplementation(async () => workspace);
  vi.mocked(updateWorkspace).mockImplementation(async (_, change) => { workspace = change(workspace) ?? workspace; });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', { locks: { request: (_: string, run: () => unknown) => run() } });
});

afterEach(() => vi.unstubAllGlobals());

it('moves a mapped legacy video and reuses it by job without downloading again', async () => {
  const root = await folder.getDirectoryHandle('Footages');
  const filename = 'EP01-S01-02.mp4';
  root.files.set(filename, new Blob(['original video']));
  workspace.footageNames = { 'job:1': filename };

  const load = () => saveFootage('project', 1, 'EP01-S01', 'EP01-S01-C01', 'job', 1);
  expect(await (await load()).text()).toBe('original video');
  expect(await (await load()).text()).toBe('original video');
  expect(root.files.has(filename)).toBe(false);
  expect((await root.getDirectoryHandle('EP01')).files.has(filename)).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('saves a new video and subtitle under the same episode folder and preserves an occupied video name', async () => {
  const root = await folder.getDirectoryHandle('Footages');
  const episode = await root.getDirectoryHandle('EP02');
  episode.files.set('EP02-S01.mp4', new Blob(['existing']));
  fetchMock
    .mockResolvedValueOnce(new Response('new video', { headers: { 'Content-Type': 'video/mp4' } }))
    .mockResolvedValueOnce(Response.json({ filename: 'EP02-subtitles.srt', text: 'subtitle', cueCount: 1 }));

  const video = await saveFootage('project', 2, 'EP02-S01', 'EP02-S01-C01', 'other-job', 1);
  expect(video.name).toBe('EP02-S01-02.mp4');
  expect(await episode.files.get('EP02-S01.mp4')?.text()).toBe('existing');
  expect(await saveEpisodeSubtitles('project', 'episode-id', 2)).toEqual({
    path: 'Project/Footages/EP02/EP02-subtitles.srt', cueCount: 1, workspaceId: 'local',
  });
  expect(await episode.files.get('EP02-subtitles.srt')?.text()).toBe('subtitle');
  expect(root.files.size).toBe(0);
});
