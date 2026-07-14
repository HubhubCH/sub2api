<template>
  <section class="user-page-hero">
    <div class="user-page-hero-copy">
      <div v-if="eyebrow || badge" class="user-page-hero-meta">
        <span v-if="eyebrow" class="user-page-hero-eyebrow">{{ eyebrow }}</span>
        <span v-if="badge" class="user-page-hero-badge">{{ badge }}</span>
      </div>
      <h1 class="user-page-hero-title">{{ title }}</h1>
      <p v-if="description" class="user-page-hero-description">{{ description }}</p>
    </div>
    <div class="user-page-hero-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none">
        <path
          d="M24 5.5 40.5 15v18L24 42.5 7.5 33V15L24 5.5Z"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linejoin="round"
        />
        <path
          d="M16.5 18.8 24 14.5l7.5 4.3v8.4L24 31.5l-7.5-4.3v-8.4Z"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linejoin="round"
          opacity="0.58"
        />
        <path
          d="M24 14.5v17"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          opacity="0.58"
        />
      </svg>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  eyebrow?: string
  badge?: string
}>()
</script>

<style scoped>
.user-page-hero {
  position: relative;
  display: flex;
  min-height: 112px;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  overflow: hidden;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.72);
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(248, 252, 255, 0.78)),
    radial-gradient(circle at 12% 12%, rgba(20, 184, 166, 0.14), transparent 30%),
    radial-gradient(circle at 92% 16%, rgba(59, 130, 246, 0.12), transparent 28%),
    radial-gradient(circle at 74% 120%, rgba(251, 146, 60, 0.08), transparent 34%);
  padding: 1.25rem 1.4rem;
  box-shadow:
    0 20px 55px rgba(47, 63, 112, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(22px);
}

.user-page-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(110deg, rgba(255, 255, 255, 0.44), transparent 34%, rgba(255, 255, 255, 0.22));
}

.user-page-hero-copy {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.user-page-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
}

.user-page-hero-eyebrow,
.user-page-hero-badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.7rem;
  border-radius: 999px;
  padding: 0 0.72rem;
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1;
  white-space: nowrap;
}

.user-page-hero-eyebrow {
  border: 1px solid rgba(45, 212, 191, 0.42);
  background: rgba(240, 253, 250, 0.78);
  color: rgb(15 118 110);
}

.user-page-hero-badge {
  border: 1px solid rgba(147, 197, 253, 0.46);
  background: rgba(239, 246, 255, 0.82);
  color: rgb(37 99 235);
}

.user-page-hero-title {
  margin: 0;
  color: rgb(15 23 42);
  font-size: clamp(1.45rem, 2vw, 2.1rem);
  font-weight: 900;
  line-height: 1.08;
}

.user-page-hero-description {
  max-width: 58rem;
  margin: 0.55rem 0 0;
  color: rgb(100 116 139);
  font-size: 0.94rem;
  line-height: 1.65;
}

.user-page-hero-mark {
  position: relative;
  z-index: 1;
  display: grid;
  width: 76px;
  height: 76px;
  flex: 0 0 76px;
  place-items: center;
  border-radius: 26px;
  color: rgb(13 148 136);
  background:
    linear-gradient(145deg, rgba(240, 253, 250, 0.94), rgba(239, 246, 255, 0.86)),
    radial-gradient(circle at 28% 18%, rgba(45, 212, 191, 0.2), transparent 45%);
  box-shadow:
    inset 0 0 0 1px rgba(153, 246, 228, 0.5),
    0 16px 30px rgba(20, 184, 166, 0.12);
}

.user-page-hero-mark svg {
  width: 42px;
  height: 42px;
}

.dark .user-page-hero {
  border-color: rgba(51, 65, 85, 0.72);
  background:
    linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(2, 8, 23, 0.82)),
    radial-gradient(circle at 12% 12%, rgba(20, 184, 166, 0.14), transparent 30%),
    radial-gradient(circle at 92% 16%, rgba(59, 130, 246, 0.12), transparent 28%);
  box-shadow:
    0 20px 55px rgba(2, 6, 23, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.dark .user-page-hero::before {
  background: linear-gradient(110deg, rgba(255, 255, 255, 0.06), transparent 34%, rgba(255, 255, 255, 0.03));
}

.dark .user-page-hero-title {
  color: rgb(248 250 252);
}

.dark .user-page-hero-description {
  color: rgb(148 163 184);
}

.dark .user-page-hero-eyebrow {
  border-color: rgba(45, 212, 191, 0.28);
  background: rgba(19, 78, 74, 0.24);
  color: rgb(153 246 228);
}

.dark .user-page-hero-badge {
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(30, 58, 138, 0.2);
  color: rgb(147 197 253);
}

.dark .user-page-hero-mark {
  color: rgb(153 246 228);
  background:
    linear-gradient(145deg, rgba(19, 78, 74, 0.68), rgba(15, 23, 42, 0.82)),
    radial-gradient(circle at 28% 18%, rgba(45, 212, 191, 0.16), transparent 45%);
  box-shadow:
    inset 0 0 0 1px rgba(45, 212, 191, 0.22),
    0 16px 30px rgba(2, 6, 23, 0.26);
}

@media (max-width: 768px) {
  .user-page-hero {
    min-height: 96px;
    border-radius: 24px;
    padding: 1rem;
  }

  .user-page-hero-mark {
    display: none;
  }

  .user-page-hero-title {
    font-size: 1.35rem;
  }

  .user-page-hero-description {
    font-size: 0.86rem;
  }
}
</style>
