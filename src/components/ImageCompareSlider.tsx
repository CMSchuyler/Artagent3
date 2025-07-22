import React, { useState, useRef, useEffect } from 'react';

interface ImageCompareSliderProps {
  originalImage: string;
  generatedImage: string;
  className?: string;
}

export const ImageCompareSlider: React.FC<ImageCompareSliderProps> = ({
  originalImage,
  generatedImage,
  className = ''
}) => {
  const [sliderPosition, setSliderPosition] = useState<number>(50);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const originalImgRef = useRef<HTMLImageElement>(null);
  const generatedImgRef = useRef<HTMLImageElement>(null);

  // 处理鼠标按下事件
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  // 处理触摸开始事件
  const handleTouchStart = () => {
    setIsDragging(true);
  };

  // 处理移动事件
  const handleMove = (clientX: number) => {
    if (!isDragging || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const containerWidth = rect.width;
    const offsetX = clientX - rect.left;
    
    // 计算滑块位置百分比（限制在0-100之间）
    const newPosition = Math.max(0, Math.min(100, (offsetX / containerWidth) * 100));
    setSliderPosition(newPosition);
  };

  // 处理鼠标移动事件
  const handleMouseMove = (e: MouseEvent) => {
    handleMove(e.clientX);
  };

  // 处理触摸移动事件
  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 0) {
      handleMove(e.touches[0].clientX);
    }
  };

  // 处理鼠标释放和触摸结束事件
  const handleRelease = () => {
    setIsDragging(false);
  };

  // 添加和移除事件监听器
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleRelease);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleRelease);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleRelease);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleRelease);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleRelease);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleRelease);
    };
  }, [isDragging]);

  return (
    <div 
      ref={containerRef}
      className={`relative ${className}`}
      style={{ 
        touchAction: 'none',
        width: '100%',
        height: '100%'
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 原始图片（底层） */}
      <img 
        ref={originalImgRef}
        src={originalImage} 
        alt="Original" 
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
      />

      {/* 生成图片（顶层，clip-path遮罩） */}
      <img 
        ref={generatedImgRef}
        src={generatedImage} 
        alt="Generated" 
        style={{ 
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`,
          pointerEvents: 'none'
        }}
      />

      {/* 滑块 */}
      <div 
        className="absolute top-0 bottom-0"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* 滑块线 */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_5px_rgba(0,0,0,0.5)]"></div>
        {/* 滑块手柄 */}
        <div 
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white shadow-lg flex items-center justify-center cursor-ew-resize"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>

      {/* 标签 - 只在鼠标悬停时显示，并且位置改为左上角和右上角 */}
      {isHovering && (
        <>
          <div className="absolute top-4 left-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
            生成图
          </div>
          <div className="absolute top-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
            原图
          </div>
        </>
      )}
    </div>
  );
}; 