---
layout: post
title: Integrate mouse and keyboard to PS4 with GIMX
---

GIMX is an open source gaming adapter that make your computer as an adapter/hub for your gaming devices. In this blog, I will try to integrate mouse and keyboard to PS4 and using Battlefield 5 as the example. Beside computer, you also need an component to connect your computer PS4 (GIMX adapter).

![gimx](https://gimx.fr/wiki/images/a/a4/Schemegeneric.png)

You can buy the GIMX adapter or create your own! this blog try to create your own GIMX adapter, to create this, you need:
- Arduino Leonardo (Leonardo R3 atmega32u4)
- USB to UART adapter (I am using PL2303)

you can get this component as cheap as $5 or Rp. 80.000.

![arduino]({{ site.baseurl }}/images/arduino.jpeg)

## User Guide

#### 1. Create GIMX adapter

Connect Arduino Leonardo with PL2303 with this following pins

| Arduino Leonardo | USB to UART board (PL2303) |
|------------------|----------------------------|
| GND              | GND                        |
| RXD1             | TXD                        |
| TXD1             | RXD                        |

![arduino]({{ site.baseurl }}/images/arduino-2.jpeg)

#### 2. Load GIMX firmware

After you create the GIMX adapter, you need to flash with GIMX firmware, the easiest way is through GIMX software itself. I am using Linux for running GIMX software, it is also support Windows, but I don't have experience dealing with Windows. You can [download from the official Github](https://github.com/matlo/GIMX/releases/tag/v8.0).

Before load the GIMX firmware, you need to connect the GIMX adapter with this schema, both Arduino Leonardo and PL2303 connected to the computer

- Install GIMX software
- Run gimx-launcher
- Click on `Help > Update firmware`
- Select a firmware (EMUPS4 for example), click on "Load", and follow the instructions
- Upon success a "Firmware loaded successfully!" message should be displayed

#### 3. Download and Setup config for your specific game

GIMX have multiple available config for specific game, you must select one of them
- Run gimx-launcher
- Click on `Help > Get Configs`
- Select specific game config, in my use cases `PS4_BattlefieldV_Godlike.xml`
- If you want to modify and check the configuration, you can go to `File > Edit config` and `File > Edit fps config`

#### 4. Run the adapter

It is ready now, follow this step to connect your mouse and keyboard to PS4:

- Connect your mouse and keyboard to the computer
- Connect your GIMX adapter to computer and PS4, connect PL2303 to the computer and Arduino Leonardo to the PS4.

![arduino]({{ site.baseurl }}/images/arduino-4.jpeg)

- Connect your PS4 Dualshock to the compute and Start PS4
- Run gimx-launcher and click start

A terminal will shown up, you must click a button in keyboard that bind to PS button in the Dualshock (the default is backspace button, please check your configuration)

Congratulations, you can use mouse and keyboard to navigate PS4 and play some games.
