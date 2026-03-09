<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="min-h-screen flex items-center justify-center">
  <div class="text-center">
    <h1 class="text-4xl font-bold text-gray-900 mb-4">Error</h1>
    <p class="text-gray-600 mb-4">{$page.error?.message || 'Something went wrong'}</p>
    <a href="/" class="text-blue-600 hover:underline">Go back home</a>
  </div>
</div>
