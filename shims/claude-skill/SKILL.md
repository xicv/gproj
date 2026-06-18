---
name: gproj
description: Use when the user wants to operate gproj's persistent planner-brain command surface. Resolve actions through the live catalog instead of static command memory.
---
<!-- gproj:begin -->
# gproj

Use the installed `gproj` CLI as the source of truth. Do not reimplement command behavior inline.

- Discover current capabilities with `gproj catalog`.
- Route intent with `gproj catalog --intent "<user task>"`.
- Check exact syntax with `gproj <cmd> --help` before running unfamiliar commands.
- Treat catalog output as an opaque interface and avoid copying command lists into this skill.
- Preserve user files and existing agent instructions outside managed gproj blocks.
<!-- gproj:end -->
