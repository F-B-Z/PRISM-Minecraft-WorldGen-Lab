import { defineStore } from "pinia";
import { ref, watch } from "vue";

const storageKey = "prism-worldgen-lab.mdf-mode.v1";

export const useMdfModeStore = defineStore("mdf_mode", () => {
    const enabled = ref(localStorage.getItem(storageKey) === "true");

    watch(enabled, value => {
        localStorage.setItem(storageKey, value ? "true" : "false");
    });

    return { enabled };
});
