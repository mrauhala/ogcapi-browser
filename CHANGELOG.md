# Changelog

## [0.5.0](https://github.com/mrauhala/ogcapi-browser/compare/v0.4.0...v0.5.0) (2026-11-08)


### Features

* check a CoverageJSON response's media type, and know it by application/vnd.cov+json ([#189](https://github.com/mrauhala/ogcapi-browser/issues/189)) ([3e64147](https://github.com/mrauhala/ogcapi-browser/commit/3e6414729bc9981be8b6f29738d60a34fb7e6c3f))
* check a response's times against CoverageJSON, the datetime asked for and the collection's extent ([#182](https://github.com/mrauhala/ogcapi-browser/issues/182)) ([c4280e1](https://github.com/mrauhala/ogcapi-browser/commit/c4280e12088b75167b93fbd4eb4315e0e547bdf2))
* check a response's units, labels and languages, and read a label in any language ([#188](https://github.com/mrauhala/ogcapi-browser/issues/188)) ([0b30f87](https://github.com/mrauhala/ogcapi-browser/commit/0b30f874ae4fd9a69c50901a115f020528c39c08))
* draw levels at a point as profiles, a panel per parameter, over one time or many ([#183](https://github.com/mrauhala/ogcapi-browser/issues/183)) ([efab740](https://github.com/mrauhala/ogcapi-browser/commit/efab74025fb2a78d1553fe24d8ef996eb846b4d9))
* read a path response as positions along it, with a sentence, a Table and its checks ([#190](https://github.com/mrauhala/ogcapi-browser/issues/190)) ([8bb70fa](https://github.com/mrauhala/ogcapi-browser/commit/8bb70fa8da42a11fe15b120227d6111f00e1721c))
* read levels at a point as profiles, and check what a response says of z ([#179](https://github.com/mrauhala/ogcapi-browser/issues/179)) ([f60f5b6](https://github.com/mrauhala/ogcapi-browser/commit/f60f5b6a165c5b7145194c2db55638213530a29a))
* say in Checks what the picture found, and cite the rule a finding rests on ([#187](https://github.com/mrauhala/ogcapi-browser/issues/187)) ([53dcbc8](https://github.com/mrauhala/ogcapi-browser/commit/53dcbc8c0f7019084ebdc1afc78c326675994214))


### Bug Fixes

* a wrong CoverageJSON response never breaks the app ([#185](https://github.com/mrauhala/ogcapi-browser/issues/185)) ([6ded986](https://github.com/mrauhala/ogcapi-browser/commit/6ded986b7524eda7b7f5e09138719855a0f50a02))
* say only what's true of a coverage, and count text apart from nulls ([#186](https://github.com/mrauhala/ogcapi-browser/issues/186)) ([45f0b50](https://github.com/mrauhala/ogcapi-browser/commit/45f0b5020c0bbfe2ede2f1fa36f3c652ea052b92))
* take z as EDR 1.1 has it, a list or a repeating interval as well as a level or a range ([#184](https://github.com/mrauhala/ogcapi-browser/issues/184)) ([f4f863a](https://github.com/mrauhala/ogcapi-browser/commit/f4f863af15c1d94f46061ec773211c59e68dd851))

## [0.4.0](https://github.com/mrauhala/ogcapi-browser/compare/v0.3.0...v0.4.0) (2026-11-07)


### Features

* draw an area or cube response's cells, in the Data tab and on the map ([#177](https://github.com/mrauhala/ogcapi-browser/issues/177)) ([12c790d](https://github.com/mrauhala/ogcapi-browser/commit/12c790dace373d74beef61bca4216c6e5b168fa2))
* draw the collection's extent as a labelled outline, without colouring the map ([#173](https://github.com/mrauhala/ogcapi-browser/issues/173)) ([9036ad2](https://github.com/mrauhala/ogcapi-browser/commit/9036ad27583a0f96edfd0e34181573407516997e))
* keep the way back and the next buttons in reach on a long form ([#172](https://github.com/mrauhala/ogcapi-browser/issues/172)) ([b102f99](https://github.com/mrauhala/ogcapi-browser/commit/b102f99ef8e52f537280de2488283ed2a8d2208f))
* link to the source, issues and version from Settings ([#171](https://github.com/mrauhala/ogcapi-browser/issues/171)) ([82c2d70](https://github.com/mrauhala/ogcapi-browser/commit/82c2d7009379342032831a13ba71b11b6b124284))
* open a collection in its own pane, replacing the list ([#168](https://github.com/mrauhala/ogcapi-browser/issues/168)) ([6f479ab](https://github.com/mrauhala/ogcapi-browser/commit/6f479ab25c5bb0b45bc302b6ccc4e2e73522320d))
* resize the left pane, and keep all three panes open down to 1012 px ([#174](https://github.com/mrauhala/ogcapi-browser/issues/174)) ([1d0d10d](https://github.com/mrauhala/ogcapi-browser/commit/1d0d10d5392a6008fa9ea61d631904a4a582d3c2))
* show CoverageJSON as a summary, a chart per parameter and a table ([#164](https://github.com/mrauhala/ogcapi-browser/issues/164)) ([0b3e0ce](https://github.com/mrauhala/ogcapi-browser/commit/0b3e0ced6dea3b7c48cfefb37347e21e3e556b00))
* show what the API was loaded from, with each resource's real response ([#176](https://github.com/mrauhala/ogcapi-browser/issues/176)) ([17740ca](https://github.com/mrauhala/ogcapi-browser/commit/17740cace60f6ad880c50ffd10e3f6072b6c9e4b))
* smaller location markers, easier to hit ([#170](https://github.com/mrauhala/ogcapi-browser/issues/170)) ([4bd9306](https://github.com/mrauhala/ogcapi-browser/commit/4bd9306ea167ad045257e45607c69360854d4c3e))


### Bug Fixes

* open collections from one place, fixing stale map data and a crash on odd IDs ([#166](https://github.com/mrauhala/ogcapi-browser/issues/166)) ([294b063](https://github.com/mrauhala/ogcapi-browser/commit/294b063ffc251f4585eba562ded2b097bc7cf3f0))

## [0.3.0](https://github.com/mrauhala/ogcapi-browser/compare/v0.2.1...v0.3.0) (2026-11-05)


### Features

* add links that reopen a request, and copy it as curl ([#161](https://github.com/mrauhala/ogcapi-browser/issues/161)) ([6b6a4b7](https://github.com/mrauhala/ogcapi-browser/commit/6b6a4b7cf105ea180fd8454f8f7c4384a3033d81))
* dock the response in a pane, and let every pane resize or close ([#157](https://github.com/mrauhala/ogcapi-browser/issues/157)) ([dec8b8f](https://github.com/mrauhala/ogcapi-browser/commit/dec8b8f04c54d5da1d08ed150a672372e5de2228))
* mobile layout with a Map/List toggle, safe areas and a page that stays put ([#146](https://github.com/mrauhala/ogcapi-browser/issues/146)) ([c818a6e](https://github.com/mrauhala/ogcapi-browser/commit/c818a6e4abbfade7b1d7d958336f5037bafa1ada))
* move the request URL under the menu and make it editable ([#158](https://github.com/mrauhala/ogcapi-browser/issues/158)) ([c98c4a8](https://github.com/mrauhala/ogcapi-browser/commit/c98c4a8cdf87b0d890f202924c835f5fa94d6cea))
* pick locations on a phone without zooming, with a way back to the overview ([#155](https://github.com/mrauhala/ogcapi-browser/issues/155)) ([0840076](https://github.com/mrauhala/ogcapi-browser/commit/08400761f2f01d4c8e547695d007170584fffe84)), closes [#153](https://github.com/mrauhala/ogcapi-browser/issues/153)
* read a response through Data, Raw, Headers, Sizes and Checks tabs ([#163](https://github.com/mrauhala/ogcapi-browser/issues/163)) ([38c5bd7](https://github.com/mrauhala/ogcapi-browser/commit/38c5bd74d07397a8e6bdc80bf2a325363d9b6336))
* show a response's status, time, size and headers, and a failure's body ([#156](https://github.com/mrauhala/ogcapi-browser/issues/156)) ([2dc3a97](https://github.com/mrauhala/ogcapi-browser/commit/2dc3a9791d91edc1b8991859a7d61d65decf16e7))
* try a failed query again from the result window ([#144](https://github.com/mrauhala/ogcapi-browser/issues/144)) ([7d26b8f](https://github.com/mrauhala/ogcapi-browser/commit/7d26b8f3dbf7b280434f876cc1d4172afd2f01da))


### Bug Fixes

* find an API's root when it's served from /api, and keep typed URLs on collections with a map ([#162](https://github.com/mrauhala/ogcapi-browser/issues/162)) ([5c7ab6b](https://github.com/mrauhala/ogcapi-browser/commit/5c7ab6b5befc0f77be5fbb1f996479fe91e92b00))
* keep a query's points when a marker is tapped, and add undo ([#154](https://github.com/mrauhala/ogcapi-browser/issues/154)) ([c79e1b6](https://github.com/mrauhala/ogcapi-browser/commit/c79e1b6e9857897ede66bc5a0ab4f152aabe7d4a))
* make the map's query input work on phones ([#147](https://github.com/mrauhala/ogcapi-browser/issues/147)) ([683f709](https://github.com/mrauhala/ogcapi-browser/commit/683f7098f4df36aa2fb989d41041dd7d7cec10ca))
* only send a time the user chose, and keep it off lists ([#159](https://github.com/mrauhala/ogcapi-browser/issues/159)) ([fcc798d](https://github.com/mrauhala/ogcapi-browser/commit/fcc798d7e188c4a6e8c977934bc59b1fbbc9b298))

## [0.2.1](https://github.com/mrauhala/ogcapi-browser/compare/v0.2.0...v0.2.1) (2026-11-03)


### Bug Fixes

* **deps:** update dependencies with security fixes ([#142](https://github.com/mrauhala/ogcapi-browser/issues/142)) ([a46b3a9](https://github.com/mrauhala/ogcapi-browser/commit/a46b3a9c72e8a200ec5121cd2bf82bbbf1287f47))

## [0.2.0](https://github.com/mrauhala/ogcapi-browser/compare/v0.1.0...v0.2.0) (2026-11-03)


### Features

* add DMI Forecast and Instituto Hidrográfico presets ([97a9f86](https://github.com/mrauhala/ogcapi-browser/commit/97a9f86b2c92c442609ca975165f2b34e3e8503b))
* deploy to GitHub Pages ([4b0ecd3](https://github.com/mrauhala/ogcapi-browser/commit/4b0ecd342335446b858491cdcc8a4586bdc19401))
* Docker image, published to GitHub Container Registry ([e13bd7b](https://github.com/mrauhala/ogcapi-browser/commit/e13bd7b0715385b54ccf288081816ecd266c622d))
* Esri Dark Gray basemap when there's no Carto key ([8e6351e](https://github.com/mrauhala/ogcapi-browser/commit/8e6351e4916c893b3ebfa41a4c7da438510b47d2))


### Bug Fixes

* chart coverages whose parameters are defined on the collection ([49c8434](https://github.com/mrauhala/ogcapi-browser/commit/49c8434bce00a7b5f2e4526006d5ebaa03d5c598))
* don't name chart series after a link ([bb1cb90](https://github.com/mrauhala/ogcapi-browser/commit/bb1cb90ef6bf27a0c94a0c0560396fdd8252a6aa))
* find the collections of a service that links conformance as data ([9eabf83](https://github.com/mrauhala/ogcapi-browser/commit/9eabf83eac43f00d754f8fe83175c2c0b1c0d22d))
* load the real OpenAPI document and report its problems readably ([b23d2e6](https://github.com/mrauhala/ogcapi-browser/commit/b23d2e6bbd0ceeb1f18fd2328fe574c97f8d4355))
* repair data query hrefs that DMI appends to the request URL ([f3b5281](https://github.com/mrauhala/ogcapi-browser/commit/f3b5281f341d0b60dc5e9fc123de91758f36bd45))
* show what the server says went wrong, and one issue count ([48cf2b7](https://github.com/mrauhala/ogcapi-browser/commit/48cf2b7d4b506e5f198e7f5bb4aa1bae06454057))
