<script setup lang="ts">
import { XoroshiroRandom } from 'deepslate';
import { useSettingsStore } from '../stores/useSettingsStore';
import { parseSeed, versionMetadata } from '../util'
import { useI18n } from 'vue-i18n';

const i18n = useI18n()

const settingsStore = useSettingsStore()

const random = XoroshiroRandom.create(BigInt(Date.now()))

function randomizeSeed() {
    settingsStore.seed = random.nextLong()
}

</script>

<template>
    <div class="settings">
        <div class="setting">
            <div class="title">{{ i18n.t('settings.mc_version.label') }}</div>
            <select :aria-label=" i18n.t('settings.mc_version.aria-label')" v-model="settingsStore.mc_version">
                <option v-for="version in Object.keys(versionMetadata)" :value="version">{{  i18n.t(`settings.mc_version.mc${version}`)}}</option>
            </select>
        </div>

        <div class="setting">
            <div class="title short">{{ i18n.t('settings.seed.label') }}</div>
            <font-awesome-icon icon="fa-dice" class="button" tabindex="0" @click="randomizeSeed"
                @keypress.enter="randomizeSeed" :title="i18n.t('settings.seed.randomize_button.title')" />
            <input :aria-label="i18n.t('settings.seed.aria-label')" :value="settingsStore.seed" @change="event => {
                settingsStore.seed = parseSeed((event.target as HTMLInputElement).value)
            }" type="text" />

        </div>
    </div>
</template>

<style scoped>
.settings {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-sizing: border-box;
}

.setting {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    height: 2rem;
}

.title {
    height: fit-content;
    width: 6.3rem;
}

.title.short {
    width: 3.8rem;
}

.button {
    background-color: var(--prism-field);
    color: black;
    padding: 0.2rem;
    height: 1.6rem;
    width: 1.6rem;
    border-radius: 0.2rem;
}

.button:hover,
.button:active {
    background-color: white;
}

select,
input {
    box-sizing: border-box;
    height: 2rem;
    background-color: var(--prism-field);
    width: 0;
    flex-grow: 1;
    color: black;
    border-radius: 0.3rem;
    border: 2px solid var(--prism-border);
}</style>
