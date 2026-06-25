<script setup lang="ts">
import { EventTracker } from '../util/EventTracker';
import { updateUrlParam } from '../util';
import { useI18n } from 'vue-i18n';

const i18n = useI18n()

function updateUrlSearch(locale: string) {
    updateUrlParam('lang', locale)
    EventTracker.track(`change_locale/${locale}`)
}

</script>

<template>
    <div class="locale-changer">
        <font-awesome-icon icon="fa-earth-europe" class="icon" :title="i18n.t('locale.change_locale.title')" />
        <select v-model="i18n.locale.value" @change="() => updateUrlSearch(i18n.locale.value)">
            <option v-for="lang in i18n.availableLocales" :key="lang" :value="lang" :dir="i18n.t('locale.text_direction', [], { locale: lang })">
                {{ i18n.t("locale.local_name", [], { locale: lang }) }}
            </option>
        </select>
    </div>
</template>

<style scoped>
    .locale-changer {
        width: 100%;
        display: flex;
        gap: 0.2rem;
    }

    .icon {
        width: 1.4rem;
        height: 1.4rem;
        padding: 0.3rem;
    }

    select {
        box-sizing: border-box;
        height: 2rem;
        background-color: lightgray;
        width: 0;
        flex-grow: 1;
        color: black;
        border-radius: 0.3rem;
        border: 2px solid rgb(55, 120, 173);
    }
</style>
