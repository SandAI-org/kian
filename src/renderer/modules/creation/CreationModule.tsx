import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReloadOutlined } from '@ant-design/icons';
import { useEffect } from 'react';
import { useAppI18n } from '@renderer/i18n/AppI18nProvider';
import { translateUiText } from '@renderer/i18n/uiTranslations';
import { api } from '@renderer/lib/api';
import { IllustrationEmptyCreationBoard } from '@renderer/components/EmptyIllustrations';
import { ScrollArea } from '@renderer/components/ScrollArea';

interface CreationModuleProps {
  projectId: string;
  onContextChange?: (context: unknown) => void;
}

export const CreationModule = ({ projectId, onContextChange }: CreationModuleProps) => {
  const queryClient = useQueryClient();
  const { language } = useAppI18n();
  const t = (value: string): string => translateUiText(language, value);

  const boardQuery = useQuery({
    queryKey: ['creation-board', projectId],
    queryFn: () => api.creation.getBoard(projectId),
    enabled: Boolean(projectId)
  });

  const board = boardQuery.data;
  const scenes = board?.scenes ?? [];
  const shotCount = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);

  useEffect(() => {
    onContextChange?.({
      sceneCount: scenes.length,
      shotCount,
      updatedAt: board?.updatedAt
    });
  }, [board?.updatedAt, onContextChange, scenes.length, shotCount]);

  return (
    <div className="cb-root">
      {/* ── Header ── */}
      <div className="cb-header">
        <div className="cb-header__left">
          <span className="cb-header__title">{t('视频场景')}</span>
          <span className="cb-header__sep" />
          <span className="cb-header__stat">{t(`场景 ${scenes.length}`)}</span>
          <span className="cb-header__stat">{t(`镜头 ${shotCount}`)}</span>
        </div>
        <button
          type="button"
          className="cb-refresh"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['creation-board', projectId] })}
        >
          <ReloadOutlined style={{ fontSize: 11 }} />
          <span>{t('刷新')}</span>
        </button>
      </div>

      {/* ── Board ── */}
      {scenes.length === 0 ? (
        <div className="cb-empty-wrap">
          <div className="cb-empty">
            <div className="cb-empty__glow cb-empty__glow--one" />
            <div className="cb-empty__glow cb-empty__glow--two" />
            <div className="cb-empty__icon">
              <IllustrationEmptyCreationBoard size={156} />
            </div>
            <div className="cb-empty__text">
              <p className="cb-empty__title">{t('还没有分镜场景')}</p>
              <p className="cb-empty__hint">{t('在右侧描述剧情和风格，AI 会自动生成场景与镜头。')}</p>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="cb-timeline">
            {scenes
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((scene, sceneIdx) => (
                <div
                  key={scene.id}
                  className="cb-scene"
                  style={{ '--scene-delay': `${sceneIdx * 60}ms` } as React.CSSProperties}
                >
                  {/* Timeline rail */}
                  <div className="cb-scene__rail">
                    <div className="cb-scene__marker">
                      <span>{String(sceneIdx + 1).padStart(2, '0')}</span>
                    </div>
                    {sceneIdx < scenes.length - 1 && <div className="cb-scene__rail-line" />}
                  </div>

                  {/* Scene body */}
                  <div className="cb-scene__body">
                    <div className="cb-scene__head">
                      <h3 className="cb-scene__title">{scene.title}</h3>
                      <span className="cb-scene__badge">
                        {t(`${scene.shots.length} 镜头`)}
                      </span>
                    </div>

                    {scene.description && (
                      <p className="cb-scene__desc">{scene.description}</p>
                    )}

                    <div className="cb-shots">
                      {scene.shots
                        .slice()
                        .sort((a, b) => a.order - b.order)
                        .map((shot, shotIdx) => (
                          <div
                            key={shot.id}
                            className="cb-shot"
                            style={
                              {
                                '--shot-delay': `${sceneIdx * 60 + shotIdx * 40 + 60}ms`
                              } as React.CSSProperties
                            }
                          >
                            <div className="cb-shot__top">
                              <span className="cb-shot__code">
                                S{String(sceneIdx + 1).padStart(2, '0')}-
                                {String(shotIdx + 1).padStart(2, '0')}
                              </span>
                              <span className="cb-shot__name">{shot.title}</span>
                              {typeof shot.duration === 'number' && (
                                <span className="cb-shot__dur">{shot.duration}s</span>
                              )}
                            </div>

                            <div className="cb-shot__prompt">
                              {shot.prompt || t('暂无 Prompt')}
                            </div>

                            {shot.notes && (
                              <div className="cb-shot__notes">
                                <span className="cb-shot__notes-tag">{t('备注')}</span>
                                {shot.notes}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
