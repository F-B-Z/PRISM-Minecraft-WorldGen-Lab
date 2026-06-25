<script setup lang="ts">
import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import LocaleChanger from './LocaleChanger.vue';
import TipMessage from './TipMessage.vue';

const showTip = ref(false);
const sourceUrl = "https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab";
const discordUrl = "https://discord.gg/md4sMp5nAy";

async function openExternal(url: string) {
    try {
        await invoke("open_external_url", { url });
    } catch {
        window.open(url, "_blank", "noopener,noreferrer");
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
            <a :href="discordUrl" @click.prevent="openExternal(discordUrl)">Join PRISM Discord</a>
        </div>
        <TipMessage v-if="showTip" class="footer-tip" @close="showTip=false" />
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

    .donate-button {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--prism-accent);
        text-decoration: underline;
        font: inherit;
        cursor: pointer;
    }

    .donate-button:hover {
        color: var(--prism-accent-2);
    }

    .footer-tip {
        margin-top: 0.45rem;
    }
</style>
