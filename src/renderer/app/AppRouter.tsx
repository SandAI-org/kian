import { Navigate, Route, Routes } from 'react-router-dom';
import { MainLayout } from './MainLayout';
import { ProjectListPage } from '@renderer/modules/project/ProjectListPage';
import { ProjectWorkspacePage } from '@renderer/modules/project/ProjectWorkspacePage';
import { SettingsPage } from '@renderer/modules/settings/SettingsPage';
import { SkillsPage } from '@renderer/modules/skills/SkillsPage';
import { CronjobPage } from '@renderer/modules/cronjob/CronjobPage';
import { TasksPage } from '@renderer/modules/tasks/TasksPage';
import { GuidePage } from '@renderer/modules/guide/GuidePage';
import { McpPage } from '@renderer/modules/mcp/McpPage';
import { MainAgentPage } from '@renderer/modules/chat/MainAgentPage';
import { QuickLauncherPage } from '@renderer/modules/quick-launcher/QuickLauncherPage';

export const AppRouter = () => {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/agent/:projectId" element={<ProjectWorkspacePage />} />
        <Route path="/project/:projectId" element={<ProjectWorkspacePage />} />
        <Route path="/main-agent" element={<MainAgentPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/cronjobs" element={<CronjobPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/quick-launcher" element={<QuickLauncherPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
