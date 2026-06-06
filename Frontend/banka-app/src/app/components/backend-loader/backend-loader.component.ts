import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { BackendLoaderService } from '../../services/backend-loader.service';

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
    trigger('quoteChange', [
      transition('* => *', [
        style({ opacity: 0, transform: 'translateY(16px)' }),
        animate('450ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
    ]),
  ],
})
export class BackendLoaderComponent {
  constructor(public loader: BackendLoaderService) {}
}
