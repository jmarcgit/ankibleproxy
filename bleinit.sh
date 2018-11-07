#!/bin/bash
sudo rfkill unblock bluetooth
sudo systemctl stop bluetooth
sudo killall bluetoothd
sudo hciconfig hci0 down
sudo hciconfig hci0 up
sudo hciconfig hci1 down
sudo hciconfig hci1 up
sudo hciconfig hci2 down
sudo hciconfig hci2 up
sudo hciconfig hci3 down
sudo hciconfig hci3 up
sudo hciconfig hci4 down
sudo hciconfig hci4 up
