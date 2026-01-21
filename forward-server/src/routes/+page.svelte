<script lang="ts">
	import { setupBackendListeners } from "$lib/backend";
	import { invoke } from "@tauri-apps/api/core";
	import { onMount } from "svelte";

	async function greet() {
		const response = await invoke<string>("greet", { name: "ZeppSlime" });
		console.log(response);
	}

	onMount(() => {
		setupBackendListeners();
	});

	greet();
</script>

<main class="">nothing here, just api stuff testing :3</main>

<style>
</style>
