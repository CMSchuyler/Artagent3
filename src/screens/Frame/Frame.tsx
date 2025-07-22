import React from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";

export const Frame = (): JSX.Element => {
  const navigate = useNavigate();
  
  // 添加清除localStorage的函数
  const clearLocalStorageSelections = () => {
    localStorage.removeItem('selectedMode');
    localStorage.removeItem('selectedPaintings');
    localStorage.removeItem('selectedAgents');
    console.log('Cleared selection data from localStorage');
  };
  
  // 监听页面刷新事件，在页面刷新前清除localStorage
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      clearLocalStorageSelections();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);
  
  // Load previously saved selections from localStorage
  const getSavedData = (key: string, defaultValue: any) => {
    try {
      const savedData = localStorage.getItem(key);
      return savedData ? JSON.parse(savedData) : defaultValue;
    } catch (e) {
      console.error(`Failed to load ${key} from localStorage`, e);
      return defaultValue;
    }
  };

  // State for selected items - initialized from localStorage if available
  const [selectedMode, setSelectedMode] = useState<number | null>(getSavedData('selectedMode', null));
  const [selectedPainting, setSelectedPainting] = useState<number | null>(null); // This is just for UI preview
  const [selectedPaintings, setSelectedPaintings] = useState<number[]>(getSavedData('selectedPaintings', []));
  const [selectedAgents, setSelectedAgents] = useState<number[]>(getSavedData('selectedAgents', []));
  
  // Save selections to localStorage when they change
  useEffect(() => {
    localStorage.setItem('selectedMode', JSON.stringify(selectedMode));
  }, [selectedMode]);
  
  useEffect(() => {
    localStorage.setItem('selectedPaintings', JSON.stringify(selectedPaintings));
  }, [selectedPaintings]);
  
  useEffect(() => {
    localStorage.setItem('selectedAgents', JSON.stringify(selectedAgents));
  }, [selectedAgents]);

  // Define the appreciation modes data
  const appreciationModes = [
    {
      id: 1,
      title: "Single-Agent\nDialogue",
    },
    {
      id: 2,
      title: "Multi-Agent\nDialogue",
    },
    {
      id: 3,
      title: "Multi-Agent\nDebate",
    },
  ];

  // Define the appreciation agents data
  const appreciationAgents = [
    {
      id: 1,
      title: "Painter",
      imageSrc: "/Painter.png",
    },
    {
      id: 2,
      title: "Art Historian",
      imageSrc: "/Art Historian.png",
    },
    {
      id: 3,
      title: "Art Theorist",
      imageSrc: "/Art Theorist.png",
    },
    {
      id: 4,
      title: "Art Collector",
      imageSrc: "/Art Collector.png",
    },
    {
      id: 5,
      title: "Art Critic",
      imageSrc: "/Art Critic.png",
    },
    {
      id: 6,
      title: "General Audience",
      imageSrc: "/General Audience.png",
    },
  ];

  // Define the artwork images data
  const artworkImages = [
    { id: 1, src: "/paintings/xrk1.jpeg", alt: "Painting xrk1" },
    { id: 2, src: "/paintings/xrk2.jpeg", alt: "Painting xrk2" },
    { id: 3, src: "/paintings/xrk3.jpeg", alt: "Painting xrk3" },
    { id: 4, src: "/paintings/xrk4.jpeg", alt: "Painting xrk4" },
    { id: 5, src: "/paintings/xrk5.jpeg", alt: "Painting xrk5" },
  ];
  
  // Set first image as default ONLY when component mounts
  useEffect(() => {
    // Only set default painting if selectedPainting is null (initial mount)
    if (selectedPainting === null) {
      // If there are already selected paintings from localStorage, use the first one for preview
      if (selectedPaintings.length > 0) {
        setSelectedPainting(selectedPaintings[0]);
      } 
      // Otherwise, if artworkImages exist, select the first one
      else if (artworkImages.length > 0) {
        setSelectedPainting(artworkImages[0].id);
      }
    }
    // 移除selectedPaintings依赖，防止它变化时重置预览
  }, [artworkImages, selectedPainting]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="w-full h-20 bg-[#57c2f3] flex items-center px-8">
        <h1 className="text-white text-3xl font-semibold">
          Subject: Sunflower
        </h1>
      </header>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-80px)]">
        {/* Left Section - Select Appreciation Painting */}
        <div className="w-1/2 p-8 bg-white">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">
            1. Select Appreciation Painting
          </h2>
          
          <div className="flex h-[calc(100vh-200px)]">
            {/* Left sidebar with thumbnails */}
            <div className="w-1/6 pr-4 pl-2 overflow-auto">
              <div className="flex flex-col gap-4">
                {artworkImages.map((painting) => (
                  <div 
                    key={painting.id} 
                    className={`relative cursor-pointer border-2 rounded-md overflow-hidden hover:shadow-lg transition-all duration-200 ${
                      selectedPainting === painting.id ? 'border-[#57c2f3] ring-2 ring-[#57c2f3]' : 'border-gray-200'
                    } ${
                      selectedPaintings.includes(painting.id) ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => setSelectedPainting(painting.id)}
                  >
                    <img 
                      src={painting.src} 
                      alt={painting.alt} 
                      className="w-full h-32 object-cover"
                    />
                    <div className="absolute bottom-2 right-2">
                      <input
                        type="checkbox"
                        id={`painting-checkbox-${painting.id}`}
                        aria-label={`Select ${painting.alt}`}
                        title={`Select ${painting.alt}`}
                        checked={selectedPaintings.includes(painting.id)}
                        onClick={(e) => e.stopPropagation()} // 阻止点击事件冒泡
                        onChange={(e) => {
                          if (e.target.checked) {
                            // 添加到选中列表，但不改变预览
                            setSelectedPaintings([...selectedPaintings, painting.id]);
                          } else {
                            // 从选中列表移除，但不改变预览
                            setSelectedPaintings(selectedPaintings.filter(id => id !== painting.id));
                            
                            // 如果取消选择的是当前预览的画作，不需要改变预览
                            // 这样用户可以预览未选择的画作
                          }
                        }}
                        className="h-5 w-5 accent-[#57c2f3]"
                      />
                      <label htmlFor={`painting-checkbox-${painting.id}`} className="sr-only">
                        Select {painting.alt}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Center area with selected painting */}
            <div className="w-5/6 flex items-center justify-center">
              {selectedPainting ? (
                <img 
                  src={artworkImages.find(p => p.id === selectedPainting)?.src} 
                  alt={artworkImages.find(p => p.id === selectedPainting)?.alt}
                  className="max-h-full max-w-full object-contain border-4 border-[#57c2f3] rounded-md shadow-xl"
                />
              ) : (
                <div className="text-gray-500 italic">
                  Please select a painting from the left
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Section */}
        <div className="w-1/2 p-8 bg-white border-l border-gray-200">
          {/* Select Appreciation Mode Section */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">
              2. Select Appreciation Mode
            </h2>

            <div className="flex gap-4">
              {appreciationModes.map((mode) => (
                <Card
                  key={mode.id}
                  className={`flex-1 cursor-pointer hover:shadow-lg transition-all duration-200 border-2 ${
                    selectedMode === mode.id 
                      ? 'border-[#57c2f3] bg-[#57c2f3]' 
                      : 'border-gray-200 hover:border-[#57c2f3] bg-white'
                  }`}
                  onClick={() => setSelectedMode(mode.id)}
                >
                  <CardContent className="p-6 text-center">
                    <div className={`text-lg font-medium whitespace-pre-line leading-tight ${
                      selectedMode === mode.id ? 'text-white' : 'text-gray-700'
                    }`}>
                      {mode.title}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Select Appreciation Agent Section */}
          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-gray-800 mb-6">
              3. Select Appreciation Agent
            </h2>
            
            {selectedMode && (
              <p className="text-gray-600 mb-4">
                {selectedMode === 1 
                  ? "Please select one agent for Single-Agent Dialogue." 
                  : "Please select multiple agents for Multi-Agent interaction."}
              </p>
            )}

            <div className="grid grid-cols-3 gap-4">
              {appreciationAgents.map((agent) => (
                <Card
                  key={agent.id}
                  className={`cursor-pointer hover:shadow-lg transition-all duration-200 border-2 ${
                    selectedAgents.includes(agent.id) 
                      ? 'border-[#57c2f3] bg-[#57c2f3]' 
                      : 'border-gray-200 hover:border-[#57c2f3] bg-white'
                  }`}
                  onClick={() => {
                    // Check if single-agent mode is selected (ID: 1)
                    if (selectedMode === 1) {
                      // Single selection - replace the entire array
                      setSelectedAgents([agent.id]);
                    } else {
                      // Multi selection - toggle selection
                      if (selectedAgents.includes(agent.id)) {
                        setSelectedAgents(selectedAgents.filter(id => id !== agent.id));
                      } else {
                        setSelectedAgents([...selectedAgents, agent.id]);
                      }
                    }
                  }}
                >
                  <CardContent className="p-6 text-center">
                    <div className="h-12 w-12 mx-auto mb-3">
                      <img 
                        src={agent.imageSrc} 
                        alt={agent.title}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className={`text-lg font-medium ${
                      selectedAgents.includes(agent.id) ? 'text-white' : 'text-gray-700'
                    }`}>
                      {agent.title}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* Start Conversation Button */}
          <div className="flex justify-center mt-20">
            <Button 
              className="bg-[#57c2f3] hover:bg-[#4ab3e8] text-white px-12 py-10 text-3xl font-bold rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 w-3/5"
              onClick={() => {
                // Validate selections
                if (!selectedMode) {
                  alert("Please select an appreciation mode");
                  return;
                }
                // Validate agents based on mode
                if (selectedMode === 1) { // Single-Agent mode
                  if (selectedAgents.length !== 1) {
                    alert("Please select exactly one appreciation agent for Single-Agent Dialogue");
                    return;
                  }
                } else { // Multi-Agent modes
                  if (selectedAgents.length < 2) {
                    alert("Please select at least two appreciation agents for Multi-Agent mode");
                    return;
                  }
                }
                if (selectedPaintings.length === 0 && !selectedPainting) {
                  alert("Please select at least one painting");
                  return;
                }
                
                // Determine which paintings to pass
                const paintingsToPass = selectedPaintings.length > 0 
                  ? selectedPaintings 
                  : selectedPainting ? [selectedPainting] : [];
                
                // Navigate to conversation page with state
                navigate('/conversation', {
                  state: {
                    selectedPaintings: paintingsToPass,
                    selectedMode,
                    selectedAgents,
                    appreciationAgents,
                    appreciationModes,
                    artworkImages
                  }
                });
              }}
            >
              Start the conversation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};