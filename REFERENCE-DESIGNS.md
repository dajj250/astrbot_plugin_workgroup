# 功能参考记录

本次团队工位为独立实现，未复制以下仓库的源码、图片或打包程序。

- dsh-team-control：https://github.com/hunmer/dsh-team-control
  - 阅读版本：0f7e4a78bcfc7af0aa30740cf2b6298877de8946
  - 仓库许可证：MIT，Copyright (c) 2026 hunmer。
  - 参考思路：任务阶段看板、成员责任、回执与执行轨迹可查。
- offAice：https://github.com/tonyAmadeus/offAice
  - 阅读版本：c6e2b59114763d83c93edeb2758a6cbe2ffbb952
  - 未找到授予整个项目复用权限的许可证；第三方依赖许可证不能替代项目授权。
  - 仅参考成员工位、模型信息、待处理事项集中展示的交互思路。

当前实现采用 AstrBot 已有接口每 2.5 秒轮询。未移植 DSH 专用子会话、DAG 调度器、SSE、offAice 的 CLI 执行器或工作副本机制。其他实例本机工具记录暂不聚合；子代理工位显示已有派单记录，不代表子代理拥有独立宿主机执行器。
