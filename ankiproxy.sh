#!/bin/bash
sudo DEBUG=ankiproxy BLENO_HCI_DEVICE_ID=$3 NOBLE_HCI_DEVICE_ID=$2 node ankiproxy.js $1
