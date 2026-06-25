<script setup lang="ts">
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import LocaleChanger from './LocaleChanger.vue';
import TipMessage from './TipMessage.vue';

const showTip = ref(false);
const showChangelog = ref(false);
const changelogLoading = ref(false);
const changelogError = ref<string | undefined>();
const releases = ref<GitHubRelease[]>([]);
const sourceUrl = "https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab";
const discordUrl = "https://discord.gg/md4sMp5nAy";
const releasesApiUrl = "https://api.github.com/repos/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases?per_page=12";

type GitHubRelease = {
    tag_name: string;
    name?: string;
    body?: string;
    html_url: string;
    published_at?: string;
    draft?: boolean;
    prerelease?: boolean;
}

const visibleReleases = computed(() => releases.value
    .filter(release => !release.draft)
    .sort((a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? ""))
);

async function openExternal(url: string) {
    try {
        await invoke("open_external_url", { url });
    } catch {
        window.open(url, "_blank", "noopener,noreferrer");
    }
}

function compactReleaseNotes(body?: string) {
    const text = (body ?? "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .split(/\r?\n/g)
        .map(line => line
            .replace(/^#{1,6}\s*/, "")
            .replace(/^[-*]\s*/, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/[`*_>]/g, "")
            .trim()
        )
        .filter(Boolean)
        .slice(0, 3);

    return text.length ? text : ["No release notes provided."];
}

function formatReleaseDate(value?: string) {
    if (!value) return "unknown date";
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit"
    }).format(new Date(value));
}

async function openChangelog() {
    showChangelog.value = true;
    if (releases.value.length > 0 || changelogLoading.value) return;

    changelogLoading.value = true;
    changelogError.value = undefined;
    try {
        const response = await fetch(releasesApiUrl, {
            headers: { Accept: "application/vnd.github+json" }
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        releases.value = await response.json() as GitHubRelease[];
    } catch (e) {
        changelogError.value = e instanceof Error ? e.message : String(e);
    } finally {
        changelogLoading.value = false;
    }
}
</script>

<template>
    <div class="footer">
        <div class="smallprint">
            <p>Copyright &copy; 2023 jacobsjo</p>
            <p>Copyright &copy; 2026 FBZ</p>
            <p id="note">Not an official Minecraft tool. Not approved by or associated with Mojang or Microsoft.</p>
            <button class="donate-button" @click="showTip = !showTip">Donate</button>
            <a :href="sourceUrl" @click.prevent="openExternal(sourceUrl)">View Source</a>
            <button class="footer-link" @click="openChangelog">Changelog</button>
            <a :href="discordUrl" @click.prevent="openExternal(discordUrl)">Join PRISM Discord</a>
        </div>
        <TipMessage v-if="showTip" class="footer-tip" @close="showTip=false" />
        <section v-if="showChangelog" class="changelog-panel" role="dialog" aria-modal="false" aria-labelledby="changelog-title">
            <header>
                <h2 id="changelog-title">GitHub changelog</h2>
                <button title="Close changelog" @click="showChangelog = false">×</button>
            </header>
            <p v-if="changelogLoading" class="changelog-state">Loading releases...</p>
            <p v-else-if="changelogError" class="changelog-state error">Could not load releases: {{ changelogError }}</p>
            <ol v-else class="release-list">
                <li v-for="release in visibleReleases" :key="release.tag_name">
                    <div class="release-title">
                        <button @click="openExternal(release.html_url)">
                            {{ release.name || release.tag_name }}
                        </button>
                        <span>{{ formatReleaseDate(release.published_at) }}</span>
                    </div>
                    <ul>
                        <li v-for="line in compactReleaseNotes(release.body)" :key="line">{{ line }}</li>
                    </ul>
                </li>
            </ol>
        </section>
        <LocaleChanger />
    </div>
</template>

<style scoped>
    .footer {
        margin-top: auto;
        position: relative;
    }

    .smallprint {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 0.5rem;
        row-gap: 0rem;
    }

    a, p {
        color: var(--prism-muted);
    }

    p {
        display: inline;
        padding: 0;
        margin: 0;
    }

    #note {
        font-size: 8pt;
    }

    a {
        text-decoration: underline;
        cursor: pointer;
    }

    a:hover {
        color: var(--prism-accent-2);
    }

    .donate-button,
    .footer-link {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--prism-accent);
        text-decoration: underline;
        font: inherit;
        cursor: pointer;
    }

    .donate-button:hover,
    .footer-link:hover {
        color: var(--prism-accent-2);
    }

    .footer-tip {
        margin-top: 0.45rem;
    }

    .changelog-panel {
        position: absolute;
        left: 0;
        bottom: 3.3rem;
        z-index: 800;
        width: min(22rem, calc(100vw - 2rem));
        max-height: 26rem;
        overflow-y: auto;
        padding: 0.7rem;
        border: 1px solid var(--prism-border);
        border-radius: 0.4rem;
        background: rgba(3, 35, 45, 0.98);
        box-shadow: 0 0.6rem 1.8rem rgba(0, 0, 0, 0.38);
        color: var(--prism-text);
    }

    .changelog-panel header,
    .release-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.6rem;
    }

    .changelog-panel h2 {
        margin: 0;
        font-size: 0.9rem;
    }

    .changelog-panel header button,
    .release-title button {
        border: 0;
        background: transparent;
        color: var(--prism-accent);
        cursor: pointer;
        font: inherit;
        text-align: left;
    }

    .changelog-panel header button {
        font-size: 1.2rem;
        line-height: 1;
    }

    .release-list {
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        margin: 0.65rem 0 0;
        padding: 0;
        list-style: none;
    }

    .release-list > li {
        padding-bottom: 0.55rem;
        border-bottom: 1px solid var(--prism-border-soft);
    }

    .release-title span,
    .changelog-state {
        color: var(--prism-muted);
        font-size: 0.68rem;
        white-space: nowrap;
    }

    .release-list ul {
        margin: 0.25rem 0 0;
        padding-left: 1rem;
        color: var(--prism-muted);
        line-height: 1.25;
    }

    .changelog-state.error {
        color: rgb(255, 178, 178);
    }
</style>
