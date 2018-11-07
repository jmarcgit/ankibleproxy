# ankibleproxy

This is a simple node program created in order to virtualize Anki Overdrive cars.

Anki uses BLE (Bluetooth Low Energy) technology for communication between cars and mobile app.
ankibleproxy will scan and connect Anki cars and then will expose itself as a virtual car. All the messages between cars and mobile app are forwarded.

Using ankibleproxy you can catch any kind of event going between cars and mobile app. The program was created in order to implement an IoT use case. The program is leveraging node and noble/bleno libraries. Works for linux and RPi.

Setup :
You need 2 BLE adapters for 1 single car : 1 is connecting the car and 1 is advertising the virtual car.
One node process is required for each car. You have the pass the 2 BLE adapters numbers in the command line. (Please look at the sh scripts). The process needs root access.
Warning : if you use several Bluetooth adapters from the same brand, they will likely share the same MAC address. So when selecting your adapters you may have to check that the address can be changed and that they are supported by linux of course. 

Known issues :
-Needs 2 BLE adapters per car at this time
-Needs a bugfree bluetooth Linux stack to run properly
-Car firmware upgrade can fail. I recommend to connect and run the cars directly once (without ankibleproxy) just after Anki app update because bricking could happen. One the firmware upgrade is done there is no problem anymore. Anyway this problem could be fixed in the future I guess.

Enjoy !
