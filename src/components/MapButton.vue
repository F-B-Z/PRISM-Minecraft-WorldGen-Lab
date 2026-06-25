<script setup lang="ts">
    const props = defineProps({
            icon: String,
            modelValue: Boolean,
            disabled: Boolean,
            title: String
        })

    const emits = defineEmits([
        'update:modelValue'
    ])

    function toggle() {
        if (!props.disabled){
            emits('update:modelValue', !props.modelValue)
        }
    }

</script>

<template>
    <font-awesome-icon :icon="icon" class="button"
        :class="{
            active: modelValue,
            disabled: disabled
        }"
        tabindex="0"
        :title="title"
        @click="toggle"
        @keypress.enter="toggle" />

</template>

<style scoped>
    .button {
        background-color: var(--prism-panel-3);
        color: var(--prism-text);
        padding: 0.3rem;
        width: 1.3rem;
        height: 1.3rem;
        border-radius: 0.3rem;
        cursor: pointer;
        border: 2px solid rgba(5, 27, 34, 0.72);
        outline: none;
    }

    .button:hover {
        background-color: var(--prism-accent);
        color: rgb(2, 17, 22);
    }

    .button:focus-visible {
        outline: 2px solid yellow   ;    
    }

    .button.active {
        background-color: var(--prism-active);
        color: rgb(2, 17, 22);
    }

    .button.disabled {
        background-color: rgba(98, 122, 130, 0.72);
        color: rgba(185, 208, 214, 0.52);
        cursor: default;
        border-color: rgb(95, 95, 95);
    }

    .button.active.disabled {
        background-color: rgba(114, 215, 200, 0.34);
    }
</style>

