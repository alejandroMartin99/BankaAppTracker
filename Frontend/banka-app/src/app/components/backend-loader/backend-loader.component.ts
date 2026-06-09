import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { BackendLoaderService } from '../../services/backend-loader.service';
import { LOADER_SHOWCASE_SLIDES } from './loader-showcase.data';

@Component({
  selector: 'app-backend-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backend-loader.component.html',
  styleUrl: './backend-loader.component.scss',
  animations: [
    trigger('overlayState', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('300ms ease-out', style({ opacity: 1 })),
      ]),
      transition(':leave', [
        animate('400ms ease-in', style({ opacity: 0 })),
      ]),
    ]),
    trigger('captureChange', [
      transition('* => *', [
        style({ opacity: 0, transform: 'scale(1.06) translateY(8px)' }),
        animate(
          '650ms cubic-bezier(0.22, 1, 0.36, 1)',
          style({ opacity: 1, transform: 'scale(1) translateY(0)' }),
        ),
      ]),
    ]),
    trigger('captionChange', [
      transition('* => *', [
        style({ opacity: 0, transform: 'translateY(20px)' }),
        animate(
          '550ms 120ms cubic-bezier(0.22, 1, 0.36, 1)',
          style({ opacity: 1, transform: 'translateY(0)' }),
        ),
      ]),
    ]),
  ],
})
export class BackendLoaderComponent implements OnInit {
  constructor(public loader: BackendLoaderService) {}

  ngOnInit(): void {
    for (const slide of LOADER_SHOWCASE_SLIDES) {
      const img = new Image();
      img.src = slide.image;
    }
  }

  get dotIndices(): number[] {
    return Array.from({ length: this.loader.showcaseCount }, (_, i) => i);
  }
}
