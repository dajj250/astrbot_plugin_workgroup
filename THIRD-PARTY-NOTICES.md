# 第三方许可与分发边界

本仓库不是“所有文件统一 MIT”。使用、修改或再分发时，应同时遵守以下分层许可。

## 工作群插件原创部分

除下述第三方内容外，`astrbot_plugin_workgroup` 的原创 Python、HTML、CSS、JavaScript、SVG、文档与测试代码采用根目录 [MIT License](LICENSE)。

## HALOFLUX 衍生视觉

- 原作：HALOFLUX by Ryder191（RYDER CODE / Ms MAIKEBAIs CAT）
- 来源：https://github.com/Ryder191/haloflux
- 适用范围：`views/workgroup/halo.html`、`views/workgroup/live-halo.js` 及与 HALOFLUX 动画和视听设计直接相关的修改部分。
- 许可：PolyForm Noncommercial License 1.0.0，并受原作者附加署名与转发说明约束。
- 完整条款：`views/workgroup/HALOFLUX-LICENSE.txt`
- 修改与署名：`views/workgroup/HALOFLUX-NOTICE.md`

HALOFLUX 衍生部分仅限非商业用途。分发完整插件包时必须保留上述许可证、作者、来源和署名。根目录 MIT 许可不会覆盖或放宽这些限制。若要把插件原创部分用于商业场景，须先移除或替换全部 HALOFLUX 衍生视觉和其他非商业内容，并自行复核剩余依赖的许可兼容性。

## 背景音乐

- 曲目：`Synthwave 421k`
- 作者：The Cynic Project（cynicmusic）
- 文件：`views/workgroup/audio/sw421k.mp3`
- 来源：HALOFLUX 参考包
- 参考包标注：CC0

音乐默认不自动播放，必须由用户主动开启。再分发时应保留本声明。CC0 1.0 说明：https://creativecommons.org/publicdomain/zero/1.0/

## 设计参考但未复制源码

`REFERENCE-DESIGNS.md` 记录了仅作为功能与交互思路参考的仓库及其许可判断。未获许可的项目内容没有作为本插件源码发布。
