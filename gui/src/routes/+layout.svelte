<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { 
    LayoutDashboard, 
    Server, 
    Route, 
    Settings, 
    Database, 
    Activity,
    Menu,
    X,
    Beaker,
    Activity as MonitorIcon
  } from '@lucide/svelte';
  import { page } from '$app/stores';

  interface Props {
    children?: import('svelte').Snippet;
  }

  let { children }: Props = $props();

  let mobileMenuOpen = $state(false);

  const navItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/test', label: 'Test Models', icon: Beaker },
    { path: '/monitor', label: 'Parallel Monitor', icon: MonitorIcon },
    { path: '/providers', label: 'Providers', icon: Server },
    { path: '/routes', label: 'Routes', icon: Route },
    { path: '/config', label: 'Configuration', icon: Settings },
    { path: '/backups', label: 'Backups', icon: Database },
    { path: '/logs', label: 'Logs', icon: Activity },
  ];

  function closeMobileMenu() {
    mobileMenuOpen = false;
  }

  function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      mobileMenuOpen = false;
    }
  }

  let currentPath = $derived($page.url.pathname);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="min-h-screen bg-gray-50">
  <!-- Mobile menu button -->
  <div class="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
    <h1 class="text-lg font-semibold text-gray-900">API Map</h1>
    <button 
      type="button"
      onclick={toggleMobileMenu}
      aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={mobileMenuOpen}
      class="p-2 rounded-md text-gray-600 hover:bg-gray-100"
    >
      {#if mobileMenuOpen}
        <X size={24} />
      {:else}
        <Menu size={24} />
      {/if}
    </button>
  </div>

  <!-- Sidebar -->
  <aside 
    class="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-gray-200 z-40 transform transition-transform duration-200 lg:translate-x-0"
    class:-translate-x-full={!mobileMenuOpen}
    class:translate-x-0={mobileMenuOpen}
  >
    <div class="p-6">
      <h1 class="text-xl font-bold text-gray-900">API Map</h1>
      <p class="text-sm text-gray-500 mt-1">Model Router</p>
    </div>

    <nav class="px-4 pb-4" aria-label="Main navigation">
      {#each navItems as item}
        <a
          href={item.path}
          onclick={closeMobileMenu}
          class="flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors mb-1"
          class:bg-blue-50={currentPath === item.path}
          class:text-blue-700={currentPath === item.path}
          class:text-gray-700={currentPath !== item.path}
          class:hover:bg-gray-100={currentPath !== item.path}
          aria-current={currentPath === item.path ? 'page' : undefined}
        >
          <item.icon size={20} />
          {item.label}
        </a>
      {/each}
    </nav>
  </aside>

  <!-- Main content -->
  <main class="lg:ml-64 min-h-screen pt-14 lg:pt-0">
    <div class="p-4 lg:p-8 max-w-7xl mx-auto">
      {#if children}
        {@render children()}
      {/if}
    </div>
  </main>

  <!-- Mobile menu overlay -->
  {#if mobileMenuOpen}
    <button
      type="button"
      onclick={closeMobileMenu}
      class="fixed inset-0 bg-black/50 z-30 lg:hidden"
      aria-label="Close menu"
    ></button>
  {/if}
</div>
