<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core';
import { useI18n } from 'vue-i18n';

const i18n = useI18n()
const kofiUrl = "https://ko-fi.com/jacobsjo";
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
    <div class="tip_message">
        <p> {{ i18n.t('tip_message.message') }} </p>
        <a :href="kofiUrl" class="kofi" @click.prevent="openExternal(kofiUrl)">
            <img src="../assets/kofi.svg" />
            {{ i18n.t('tip_message.kofi') }}
        </a>
        <p class="prism_support">
            If you want to support PRISM development too, ask in the
            <a :href="discordUrl" @click.prevent="openExternal(discordUrl)">PRISM Discord</a>.
            I will set up a dedicated option when there is interest.
        </p>
        <div class="closing_x" tabindex="0" @click="$emit('close')" @keypress.enter="$emit('close')"
            :title="i18n.t('tip_message.close')">&times;</div>
    </div>

</template>

<style scoped>
@import url('https://fonts.googleapis.com/css?family=Lato&subset=latin,latin-ext');

.tip_message {
    border: 1px solid var(--prism-border);
    border-radius: 0.4rem;
    padding: 0.5rem;
    background-color: var(--prism-bg);
    position: relative;
    margin-top: -0.5rem;
    margin-bottom: -0.5rem;
    display: flex;
    gap: 0.5rem;
    flex-direction: column;
    align-items: center;
}

.tip_message p {
    padding: 0 0.3rem;
    margin: 0;
}

a {
    display: block;
    color: white;
    padding: 0.3rem 1rem;
    border-radius: 10rem;
    font-family: 'Lato', Helvetica, Century Gothic, sans-serif;
    text-decoration: none;
    text-shadow: none;
    font-weight: 1000;
    font-size: 14px;
    user-select: none;
    cursor: pointer;
    transition: 0.2s;
}

a.kofi {
    background-color: #FF5E5B;
}

a.kofi:hover {
    background-color: #ff8b89;
}

a img{
    height: 13px;
    width: 20px;
    padding-inline-end: 0.3rem;
}

.prism_support {
    color: var(--prism-muted);
    font-size: 0.72rem;
    line-height: 1.25;
    text-align: center;
}

.prism_support a {
    display: inline;
    padding: 0;
    border-radius: 0;
    color: var(--prism-accent);
    background: transparent;
    font-family: inherit;
    font-size: inherit;
    text-decoration: underline;
}

.prism_support a:hover {
    color: var(--prism-accent-2);
}

.closing_x {
    position: absolute;
    text-align: center;
    right: -0.5rem;
    top: -0.5rem;
    width: 2rem;
    height: 2rem;
    font-size: 1.5rem;
    color: var(--prism-muted);
    cursor: pointer;
}

.closing_x:hover {
    color: var(--prism-text);
}
</style>
