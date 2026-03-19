import { useEffect, useMemo, useState } from 'react';
import { Input, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { SearchOutlined } from '@ant-design/icons';
import type { AssetDTO } from '@shared/types';
import { api } from '@renderer/lib/api';
import { ScrollArea } from '@renderer/components/ScrollArea';
import { RevealableImage } from '@renderer/components/RevealableImage';

interface AssetsModuleProps {
  projectId: string;
  onContextChange?: (context: unknown) => void;
}

type AssetTagFilter = 'user' | 'generated';

const ASSET_TAG_FILTER_OPTIONS: Array<{ value: AssetTagFilter; label: string }> = [
  { value: 'user', label: '用户' },
  { value: 'generated', label: 'AI 生成' }
];

const parseAssetTags = (asset: AssetDTO): string[] => {
  try {
    const parsed = JSON.parse(asset.tagsJson ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLowerCase());
  } catch {
    return [];
  }
};


const getAssetTypeLabel = (type: AssetDTO['type']): string => {
  if (type === 'image') return '图片';
  if (type === 'video') return '视频';
  if (type === 'audio') return '音频';
  return '文件';
};

const getAssetSourceTag = (tags: string[]): string | null => {
  if (tags.includes('generated')) {
    return 'AI 生成';
  }
  if (tags.includes('user')) {
    return '用户';
  }
  return null;
};

const LOCAL_MEDIA_SCHEME_PREFIX = 'kian-local://local/';
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const UNSAFE_URL_PATTERN = /^(?:javascript|vbscript):/i;

const toLocalMediaUrl = (rawPath: string): string => `${LOCAL_MEDIA_SCHEME_PREFIX}${encodeURIComponent(rawPath)}`;

const resolveAssetPreviewUrl = (rawPath?: string | null): string => {
  const normalized = rawPath?.trim() ?? '';
  if (!normalized) return '';
  if (UNSAFE_URL_PATTERN.test(normalized.toLowerCase())) return '';
  if (/^(?:https?|file|data|blob|kian-local):/i.test(normalized)) return normalized;
  if (normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(normalized) || normalized.startsWith('\\\\')) {
    return toLocalMediaUrl(normalized);
  }
  return '';
};
export const AssetsModule = ({ projectId, onContextChange }: AssetsModuleProps) => {
  const [search, setSearch] = useState('');
  const [selectedTagFilters, setSelectedTagFilters] = useState<AssetTagFilter[]>([]);

  const assetsQuery = useQuery({
    queryKey: ['assets', projectId, search],
    queryFn: () =>
      api.assets.list(projectId, {
        search: search.trim() || undefined
      }),
    enabled: Boolean(projectId)
  });

  const rawAssets = assetsQuery.data ?? [];
  const assets = useMemo(() => {
    if (selectedTagFilters.length === 0) return rawAssets;
    return rawAssets.filter((asset) => {
      const tags = parseAssetTags(asset);
      return selectedTagFilters.some((filter) => tags.includes(filter));
    });
  }, [rawAssets, selectedTagFilters]);

  useEffect(() => {
    onContextChange?.({
      assetCount: assets.length,
      keyword: search,
      tags: selectedTagFilters
    });
  }, [assets.length, onContextChange, search, selectedTagFilters]);

  const handleToggleTagFilter = (tag: AssetTagFilter): void => {
    setSelectedTagFilters((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  };

  const handleOpenAsset = (asset: AssetDTO): void => {
    const targetPath = asset.absolutePath?.trim();
    if (!targetPath) {
      message.error('素材路径不可用，无法打开系统预览');
      return;
    }
    void api.file.open(targetPath).catch((error) => {
      message.error(error instanceof Error ? error.message : '打开系统预览失败');
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Input
          prefix={<SearchOutlined className="text-slate-400" />}
          placeholder="搜索素材"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="!w-56 sm:!w-72 [&_.ant-input]:!text-[12px] [&_.ant-input-prefix]:!text-[12px]"
          style={{ borderRadius: 999, height: 36 }}
        />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {ASSET_TAG_FILTER_OPTIONS.map((item) => {
            const active = selectedTagFilters.includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => handleToggleTagFilter(item.value)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? 'border-[#111827] bg-[#111827] text-white'
                    : 'border-[#d9e2f0] bg-white/80 text-slate-600 hover:border-slate-400 hover:text-slate-800'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {assetsQuery.isLoading ? (
        <div className="asset-empty-wrap">
          <div className="asset-loading">素材加载中...</div>
        </div>
      ) : assets.length === 0 ? (
        <div className="asset-empty-wrap">
          <div className="asset-empty">
            <div className="asset-empty__glow asset-empty__glow--one" />
            <div className="asset-empty__glow asset-empty__glow--two" />
            <div className="asset-empty__icon">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect
                  x="10"
                  y="14"
                  width="30"
                  height="24"
                  rx="4"
                  stroke="var(--asset-empty-icon-stroke-soft)"
                  strokeWidth="1.5"
                  fill="none"
                  opacity="0.5"
                  transform="rotate(-3 25 26)"
                />
                <rect
                  x="16"
                  y="10"
                  width="30"
                  height="24"
                  rx="4"
                  stroke="var(--asset-empty-icon-stroke)"
                  strokeWidth="1.5"
                  fill="var(--asset-empty-icon-fill)"
                  transform="rotate(2 31 22)"
                />
                <circle
                  cx="25"
                  cy="19"
                  r="3"
                  stroke="var(--asset-empty-icon-stroke)"
                  strokeWidth="1.2"
                  fill="none"
                />
                <path
                  d="M18 30 L26 23 L31 27 L38 20 L44 26"
                  stroke="var(--asset-empty-icon-stroke)"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="asset-empty__text">
              <p className="asset-empty__title">暂无素材</p>
              <p className="asset-empty__hint">所有的音视频素材都将汇聚于此，可以试试直接给我说 “生成一张漂亮的落日照片“</p>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {assets.map((asset) => {
              const tags = parseAssetTags(asset);
              const sourceTag = getAssetSourceTag(tags);
              const previewUrl =
                asset.type === 'image' ? resolveAssetPreviewUrl(asset.absolutePath ?? asset.path) : '';
              return (
                <div key={asset.id} className="overflow-hidden rounded-md border border-[#e5ebf5] bg-white">
                  <button
                    type="button"
                    className="group relative block w-full overflow-hidden bg-[#f2f5fb] text-left"
                    style={{ aspectRatio: '16 / 9' }}
                    onClick={() => handleOpenAsset(asset)}
                    title="点击使用系统预览打开"
                  >
                    {previewUrl ? (
                      <RevealableImage
                        src={previewUrl}
                        alt={asset.name}
                        filePath={asset.absolutePath ?? undefined}
                        className="absolute inset-0 h-full w-full"
                        imageClassName="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        {getAssetTypeLabel(asset.type)}
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
                      {sourceTag ? <span className="rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm">{sourceTag}</span> : <span />}
                      <span className="rounded-full bg-black/45 px-2.5 py-1 text-xs font-medium text-white shadow-sm backdrop-blur-sm">
                        {getAssetTypeLabel(asset.type)}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
