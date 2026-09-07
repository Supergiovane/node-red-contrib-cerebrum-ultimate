<script setup>
defineProps({ name: { type: String, default: 'brain' } });
const paths = {
  overview: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  brain: 'M12 5c-3-5-8-1-7 2-4 1-4 7-1 8-1 4 5 7 8 3 3 4 9 1 8-3 3-1 3-7-1-8 1-3-4-7-7-2Zm0 0v13M5 7l3 2m-4 6 4-2m11-6-3 2m4 6-4-2',
  knx: 'M3 4h18v5H3zM7 9v5m10-5v5M3 15h8v5H3zm10 0h8v5h-8z',
  etsAccess: 'M4 5h16M4 12h16M4 19h16M8 3v4m8 3v4m-8 3v4',
  areas: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  tests: 'M9 3h6m-5 0v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 15h8',
  results: 'M8 3h8v4H8zM8 5H5v16h14V5h-3M8 13l2 2 5-5',
  flowBuilder: 'M3 3h6v6H3zm12 12h6v6h-6zM6 9v9h9M15 6h6m-3-3v6',
  settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
};
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[name] || paths.brain" />
  </svg>
</template>
