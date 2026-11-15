import React, { useEffect, useState } from 'react';
import {
  Home,
  MessageSquare,
  Users,
  CircleDot,
  Globe,
  BookOpen,
  Timer,
  FolderOpen,
  Calendar,
  PenTool,
  Bell,
  Lock,
  User,
  Settings,
  ShieldAlert,
  Search,
  Sun,
  Moon,
  Menu,
  X,
  ChevronRight,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useDeviceViewport } from '../hooks/useDeviceViewport';
import { BRAND_CONFIG } from '../config/brand';
import { AppTab } from '../types/konnecta';
import { PWAInstallButton } from './PWAInstallButton';
import { SmartSearchModal } from './SmartSearchModal';
import { HomeFeedModule } from './modules/HomeFeedModule';
import { MessagesModule } from './modules/MessagesModule';
import { FriendsModule } from './modules/FriendsModule';
import { StoriesModule } from './modules/StoriesModule';
import { CommunitiesModule } from './modules/CommunitiesModule';
import { StudyZoneModule } from './modules/StudyZoneModule';
import { StudyRoomsModule } from './modules/StudyRoomsModule';
import { EventsModule } from './modules/EventsModule';
import { WhiteboardModule } from './modules/WhiteboardModule';
import { NotificationsModule } from './modules/NotificationsModule';
import { VaultModule } from './modules/VaultModule';
import { ProfileModule } from './modules/ProfileModule';
import { SettingsModule } from './modules/SettingsModule';
import { ModerationModule } from './modules/ModerationModule';

interface NavItem {
  id: AppTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'social' | 'study' | 'account';
  badge?: number;
}

export const AppShell: React.FC = () => {
  const { publicProfile, unreadNotifCount, keyBundle, theme, updateThemePrefs } = useApp();
  const { deviceTier, isCompactHeight } = useDeviceViewport();
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [selectedPeerUid, setSelectedPeerUid] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Automatically close drawer when moving to desktop viewport
  useEffect(() => {
    if (deviceTier === 'desktop' || deviceTier === 'wide') {
      setMobileMenuOpen(false);
    }
  }, [deviceTier]);

  const navItems: NavItem[] = [
    { id: 'home', label: 'Home Feed', icon: Home, group: 'social' },
    { id: 'messages', label: 'Messages', icon: MessageSquare, group: 'social' },
    { id: 'friends', label: 'Friends & Contacts', icon: Users, group: 'social' },
    { id: 'stories', label: 'Stories', icon: CircleDot, group: 'social' },
    { id: 'communities', label: 'Communities', icon: Globe, group: 'social' },
    { id: 'study-zone', label: 'Study Zone', icon: BookOpen, group: 'study' },
    { id: 'study-rooms', label: 'Study Rooms', icon: Timer, group: 'study' },
    { id: 'shared-files', label: 'Shared Files', icon: FolderOpen, group: 'study' },
    { id: 'events', label: 'Events', icon: Calendar, group: 'study' },
    { id: 'whiteboard', label: 'Whiteboard', icon: PenTool, group: 'study' },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      group: 'account',
      badge: unreadNotifCount > 0 ? unreadNotifCount : undefined,
    },
    { id: 'vault', label: 'Personal Vault', icon: Lock, group: 'account' },
    { id: 'profile', label: 'My Profile', icon: User, group: 'account' },
    { id: 'settings', label: 'Settings', icon: Settings, group: 'account' },
    { id: 'moderation', label: 'Safety & Moderation', icon: ShieldAlert, group: 'account' },
  ];

  const handleSelectTab = (tab: AppTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const handleStartChat = (peerUid: string) => {
    setSelectedPeerUid(peerUid);
    setActiveTab('messages');
    setMobileMenuOpen(false);
  };

  const activeItem = navItems.find((n) => n.id === activeTab) || navItems[0];
  const showBottomBar = !isCompactHeight;

  const renderGroup = (group: NavItem['group'], title: string, compact = false) => (
    <div className="space-y-1">
      {!compact && (
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          {title}
        </p>
      )}
      {navItems
        .filter((i) => i.group === group)
        .map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={compact ? item.label : undefined}
              onClick={() => handleSelectTab(item.id)}
              className={`w-full flex items-center ${
                compact ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2.5'
              } rounded-xl text-[13px] font-medium transition-all duration-150 cursor-pointer relative min-h-[42px] ${
                active
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/20'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className={`flex items-center ${compact ? 'justify-center' : 'gap-3'} min-w-0`}>
                <item.icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-white' : 'text-slate-400 dark:text-slate-400'
                  }`}
                />
                {!compact && <span className="truncate whitespace-nowrap">{item.label}</span>}
              </span>
              {item.badge !== undefined && (
                <span
                  className={`text-[11px] font-semibold min-w-[20px] h-5 px-1.5 rounded-full inline-flex items-center justify-center tabular-nums ${
                    compact ? 'absolute top-1 right-1 scale-75' : ''
                  } ${active ? 'bg-white/20 text-white' : 'bg-indigo-600 text-white'}`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
    </div>
  );

  return (
    <div className="min-h-[100dvh] w-full overflow-x-clip bg-slate-50 dark:bg-[#090C15] text-slate-900 dark:text-slate-100 flex">
      {/* Desktop / Large Tablet Left Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:shrink-0 border-r border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0E1320] sticky top-0 h-[100dvh] transition-[width] duration-200 ${
          sidebarCollapsed ? 'lg:w-[74px]' : 'lg:w-60 xl:w-64'
        }`}
      >
        <div
          className={`px-3.5 py-4 flex items-center ${
            sidebarCollapsed ? 'justify-center' : 'justify-between gap-2'
          } border-b border-slate-200 dark:border-slate-800/80 shrink-0`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-sm shadow-sm shadow-indigo-500/25 shrink-0">
              K
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <span className="font-bold tracking-tight text-sm text-slate-900 dark:text-white block leading-tight">
                  {BRAND_CONFIG.name}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                  {BRAND_CONFIG.tagline}
                </span>
              </div>
            )}
          </div>

          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Compact sidebar"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {sidebarCollapsed && (
          <div className="px-2 pt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
          {renderGroup('social', 'Social Space', sidebarCollapsed)}
          {renderGroup('study', 'Study & Creation', sidebarCollapsed)}
          {renderGroup('account', 'Privacy & Account', sidebarCollapsed)}
        </nav>

        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => handleSelectTab('profile')}
            title={sidebarCollapsed ? publicProfile?.displayName || 'My Profile' : undefined}
            className={`w-full flex items-center ${
              sidebarCollapsed ? 'justify-center p-1.5' : 'gap-2.5 p-2'
            } rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/70 text-left transition-colors cursor-pointer`}
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
              {publicProfile?.avatarUrl ? (
                <img
                  src={publicProfile.avatarUrl}
                  alt={publicProfile.displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                (publicProfile?.displayName || 'K').charAt(0).toUpperCase()
              )}
            </div>
            {!sidebarCollapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate text-slate-900 dark:text-white">
                    {publicProfile?.displayName || 'Member'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    @{publicProfile?.username || 'user'}
                  </p>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Utility Header */}
        <header className="min-h-[3.5rem] sm:min-h-[4rem] pt-safe px-3 sm:px-5 lg:px-8 border-b border-slate-200 dark:border-slate-800/80 bg-white/90 dark:bg-[#0E1320]/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 max-w-md">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden min-w-[40px] min-h-[40px] -ml-1 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] text-xs text-slate-500 hover:border-indigo-500/70 transition-colors cursor-pointer min-w-0"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="sm:hidden truncate">Search...</span>
                <span className="hidden sm:inline truncate">Search messages, notes, friends, files...</span>
              </span>
              <kbd className="hidden md:inline text-[10px] font-mono text-slate-400 shrink-0">⌘K</kbd>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="hidden xl:inline text-xs font-medium text-slate-500 dark:text-slate-400 mr-2">
              {activeItem.label}
            </span>

            {keyBundle && (
              <button
                type="button"
                onClick={() => handleSelectTab('settings')}
                title="View E2EE key fingerprint & device security"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-indigo-500/60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="hidden md:inline">E2EE Protected</span>
                <span className="md:hidden">E2EE</span>
              </button>
            )}

            <PWAInstallButton variant="compact" />

            <button
              type="button"
              onClick={() => updateThemePrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}
              aria-label="Toggle color theme"
              className="min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => handleSelectTab('notifications')}
              aria-label="Open notifications"
              className="relative min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#090C15] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Active Module Viewport — automatically fits mobile, foldable, tablet, laptop, TV/wide */}
        <main
          className={`flex-1 w-full max-w-[1440px] mx-auto px-3 py-3 sm:px-5 sm:py-5 lg:px-8 lg:py-7 px-safe ${
            showBottomBar ? 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-8' : 'pb-6 lg:pb-8'
          }`}
        >
          {activeTab === 'home' && <HomeFeedModule onNavigate={handleSelectTab} />}
          {activeTab === 'messages' && <MessagesModule initialPeerUid={selectedPeerUid} />}
          {activeTab === 'friends' && <FriendsModule onStartChat={handleStartChat} />}
          {activeTab === 'stories' && <StoriesModule />}
          {activeTab === 'communities' && <CommunitiesModule />}
          {activeTab === 'study-zone' && (
            <StudyZoneModule key="study-zone" initialTab="documents" initialVisibilityFilter="all" />
          )}
          {activeTab === 'shared-files' && (
            <StudyZoneModule key="shared-files" initialTab="documents" initialVisibilityFilter="shared" />
          )}
          {activeTab === 'study-rooms' && <StudyRoomsModule />}
          {activeTab === 'events' && <EventsModule />}
          {activeTab === 'whiteboard' && <WhiteboardModule />}
          {activeTab === 'notifications' && <NotificationsModule onNavigate={handleSelectTab} />}
          {activeTab === 'vault' && <VaultModule />}
          {activeTab === 'profile' && <ProfileModule />}
          {activeTab === 'settings' && <SettingsModule />}
          {activeTab === 'moderation' && <ModerationModule />}
        </main>
      </div>

      {/* Mobile & Portrait Tablet Bottom Navigation (auto-hides on ultra-short landscape phones) */}
      {showBottomBar && (
        <nav
          aria-label="Primary mobile navigation"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 pb-safe border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0E1320]/95 backdrop-blur-md grid grid-cols-5"
        >
          {([
            { id: 'home', label: 'Home', icon: Home },
            { id: 'messages', label: 'Chats', icon: MessageSquare },
            { id: 'study-zone', label: 'Study', icon: BookOpen },
            { id: 'friends', label: 'Friends', icon: Users },
          ] as const).map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                  active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span className="truncate max-w-full px-1">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
          >
            <Menu className="w-4 h-4" />
            <span>More</span>
          </button>
        </nav>
      )}

      {/* Mobile & Tablet Slide-Over Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] bg-white dark:bg-[#0E1320] h-[100dvh] pt-safe pb-safe p-4 overflow-y-auto space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  K
                </div>
                <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {BRAND_CONFIG.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderGroup('social', 'Social Space')}
            {renderGroup('study', 'Study & Creation')}
            {renderGroup('account', 'Privacy & Account')}
          </div>
        </div>
      )}

      <SmartSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSelectTab}
      />
    </div>
  );
};
