---
layout: post
title: Managing tools version using asdf
---

Since my job is mainly related to cloud stuff, I need to change tools version multiple time. Some tools like kubectl, istioctl, and helm have multiple version and behave different between the version. Changing version of these tools is not easy and repetitive task.

asdf is a command provided to manage many tools like them. Do automatic download and changing version is a second. You can check [official documentation of asdf](https://asdf-vm.com/#/core-manage-asdf-vm). I will copy some of the installation for zsh.

### Installation
- Clone asdf repository
```
git clone https://github.com/asdf-vm/asdf.git ~/.asdf
cd ~/.asdf
git checkout "$(git describe --abbrev=0 --tags)"
```
- Update zsh
```
vi ~/.zshrc

. $HOME/.asdf/asdf.sh
```
- Reload zsh

### Documentation
- to list all tools that installed or already available in your system
```
$ asdf list
helm
  3.2.1
istioctl
  1.4.5
  1.5.4
  1.6.0
jq
  1.6
  jq-1.6
kubectl
  1.15.11
vault
  1.4.0
```

- Adding plugin
```
asdf plugin-add istioctl
```

- Download plugin
```
asdf install istioctl 1.5.4
```

- Set spesific plugin version to global
```
asdf global istioctl 1.5.4
```
