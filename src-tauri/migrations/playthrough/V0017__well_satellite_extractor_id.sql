-- The Resource Well Pressuriser (`Build_FrackingSmasher_C`) is the
-- clocked, powered building; the satellites around it place a Resource
-- Well Extractor (`Build_FrackingExtractor_C`) and inherit the
-- Pressuriser's clock. Before the app modelled that split, a well
-- satellite's claim had only the Pressuriser's class id to store, so
-- every saved claim carries it instead of the extractor's own.
--
-- Neither `extractor_output_ipm` nor `extractor_power_mw` reads a
-- FrackingWell claim's `miner_id` (both are mark-independent for
-- wells), so retargeting these rows changes no throughput or power
-- figure — only the id the UI reads back for the picker and the label.
UPDATE resource_node_claim
SET miner_id = 'Build_FrackingExtractor_C'
WHERE miner_id = 'Build_FrackingSmasher_C';
