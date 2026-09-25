self.__hits = 0;
chrome.commands.onCommand.addListener((c) => { self.__hits++; self.__last = c; });
